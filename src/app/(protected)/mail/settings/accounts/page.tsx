'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, Globe, Loader2, Mail, Plug, RefreshCw, Server, ShieldCheck, Unplug, Users } from 'lucide-react';

import { useMailHub } from '@/components/mail-hub/hooks';
import { AccountStatusBadge, PageHeader, RecoveryPanel, formatLong } from '@/components/mail-hub/ui';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { mailApi, startOAuth, type AccountRow } from '@/lib/mail-hub/client';
import { cn } from '@/lib/utils';

const PROVIDER_ICON = { gmail: Globe, microsoft: Mail, imap: Server } as const;
const PROVIDER_BLURB = {
  gmail: 'Sign in with Google. The ERP asks only to read, label, send and move mail to Trash — never to delete it permanently.',
  microsoft: 'Sign in with your work account. The ERP asks for your own mailbox only; shared-mailbox access is requested separately.',
  imap: 'The company mail server (the one behind Roundcube). Your password is verified, encrypted and never shown again.',
} as const;

export default function MailAccountsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname() ?? '/mail/settings/accounts';
  const params = useSearchParams();
  const { data, refresh, bump } = useMailHub();
  const [imapOpen, setImapOpen] = useState<{ kind: 'personal' | 'shared'; accountId?: string; email?: string; presetId?: string } | null>(null);
  const [sharedOpen, setSharedOpen] = useState<'gmail' | 'microsoft' | null>(null);
  const [confirm, setConfirm] = useState<AccountRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  // The OAuth callback reports back through query parameters.
  useEffect(() => {
    const outcome = params?.get('connect');
    if (!outcome) return;
    const message = params?.get('message') ?? (outcome === 'connected' ? 'Connected.' : 'The mailbox was not connected.');
    setNotice({ tone: outcome === 'connected' ? 'good' : 'bad', text: message });
    router.replace(pathname, { scroll: false });
    void refresh();
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return null;
  const caps = data.capabilities;

  const connect = async (provider: 'gmail' | 'microsoft' | 'imap') => {
    if (provider === 'imap') return setImapOpen({ kind: 'personal' });
    setBusy(provider);
    try {
      await startOAuth(provider, { purpose: 'personal', returnTo: '/mail/settings/accounts' });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Cannot start sign-in', description: caught instanceof Error ? `${caught.message}${(caught as { detail?: string }).detail ? ` ${(caught as { detail?: string }).detail}` : ''}` : undefined });
      setBusy(null);
    }
  };

  const reconnect = async (account: AccountRow) => {
    if (account.provider === 'imap') return setImapOpen({ kind: account.kind, accountId: account.id, email: account.emailAddress, presetId: account.imapServerId ?? undefined });
    try {
      await startOAuth(account.provider, { purpose: 'reconnect', accountId: account.id, returnTo: '/mail/settings/accounts' });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Cannot start sign-in', description: caught instanceof Error ? caught.message : undefined });
    }
  };

  const sync = async (account: AccountRow, action: 'sync' | 'resync') => {
    setBusy(`${action}:${account.id}`);
    try {
      await mailApi.syncAccount(account.id, action);
      toast({ title: action === 'resync' ? 'Rebuilding this mailbox in the background' : 'Synced' });
      await refresh();
      bump();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Sync failed', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (account: AccountRow) => {
    setBusy(`disconnect:${account.id}`);
    try {
      const result = await mailApi.disconnect(account.id);
      setNotice({ tone: 'good', text: result.message });
      await refresh();
      bump();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Could not disconnect', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const accounts = data.accounts.filter((account) => account.status !== 'disconnected' || account.access.canManage);

  return (
    <div className="space-y-4">
      <PageHeader title="Email accounts" description="Each mailbox you connect is yours alone: nobody else in the ERP — administrators included — can read it." />

      {notice && (
        <div role="status" className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', notice.tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900')}>
          {notice.tone === 'good' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <Unplug className="mt-0.5 h-4 w-4" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {caps.canConnectAccount && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Plug className="h-4 w-4" /> Connect email account</CardTitle>
            <CardDescription>You can connect more than one.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {data.providers.map((entry) => {
              const Icon = PROVIDER_ICON[entry.provider];
              return (
                <div key={entry.provider} className={cn('flex flex-col gap-2 rounded-xl border p-3', !entry.available && 'bg-slate-50')}>
                  <p className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" /> {entry.label}</p>
                  <p className="flex-1 text-xs text-muted-foreground">{PROVIDER_BLURB[entry.provider]}</p>
                  {entry.available ? (
                    <Button size="sm" onClick={() => connect(entry.provider)} disabled={busy === entry.provider}>
                      {busy === entry.provider && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect
                    </Button>
                  ) : (
                    <div className="text-xs text-slate-500">
                      <p>Not available on this server yet.</p>
                      {entry.problems.length > 0 && <ul className="mt-1 list-disc pl-4 text-amber-800">{entry.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connected mailboxes</CardTitle>
          <CardDescription>Sync runs in the background. Push-enabled mailboxes update within moments; others are checked every few minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.length === 0 && <p className="text-sm text-muted-foreground">No mailboxes connected yet.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="rounded-xl border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{account.sharedMailboxName ?? account.emailAddress}</span>
                    <AccountStatusBadge account={account} />
                    {account.kind === 'shared' && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" /> shared</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {account.provider === 'gmail' ? 'Google' : account.provider === 'microsoft' ? 'Microsoft 365' : 'IMAP/SMTP'}
                    {account.loginIdentity && account.loginIdentity !== account.emailAddress ? ` · via ${account.loginIdentity}` : ''}
                    {' · '}
                    {account.watch.kind === 'gmail-watch' || account.watch.kind === 'graph-subscription' ? 'push notifications' : 'polling'}
                    {' · last synced '}
                    {account.sync.lastSuccessAt ? formatLong(account.sync.lastSuccessAt) : 'not yet'}
                    {account.status === 'connecting' ? ` · ${account.sync.messagesSynced} messages so far` : ''}
                  </p>
                  {account.identities.some((identity) => identity.verified) && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3 w-3" /> Can also send as {account.identities.filter((identity) => identity.verified).map((identity) => identity.address).join(', ')}</p>
                  )}
                </div>
                {account.access.canManage && account.status !== 'disconnected' && (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => sync(account, 'sync')} disabled={Boolean(busy)}>
                      {busy === `sync:${account.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Sync now
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => sync(account, 'resync')} disabled={Boolean(busy)} title="Rebuild the ERP's copy of this mailbox from scratch">Rebuild</Button>
                    <Button size="sm" variant="outline" className="text-rose-700" onClick={() => setConfirm(account)} disabled={Boolean(busy)}>
                      <Unplug className="mr-1.5 h-3.5 w-3.5" />Disconnect
                    </Button>
                  </div>
                )}
                {account.access.canManage && account.status === 'disconnected' && (
                  <Button size="sm" onClick={() => reconnect(account)}>Connect again</Button>
                )}
              </div>
              {account.recovery && account.status !== 'active' && account.status !== 'disconnected' && (
                <div className="mt-2">
                  <RecoveryPanel
                    advice={account.recovery}
                    actions={
                      account.access.canManage && account.recovery.action === 'reconnect' ? <Button size="sm" onClick={() => reconnect(account)}>Reconnect</Button>
                      : account.access.canManage && account.recovery.action === 'retry' ? <Button size="sm" variant="outline" className="bg-white" onClick={() => sync(account, 'sync')}>Retry now</Button>
                      : null
                    }
                  />
                </div>
              )}
              {account.kind === 'shared' && !account.access.canRead && account.access.reason && <p className="mt-2 text-xs text-muted-foreground">{account.access.reason}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      {caps.canAdministerConnections && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Connect a shared mailbox</CardTitle>
            <CardDescription>
              The connection syncs the team mailbox. Members are added on Permissions & sharing, and each member must also be granted the mailbox by the email provider — the ERP checks that with their own account before they can read it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.providers.filter((entry) => entry.available).map((entry) => (
              <Button key={entry.provider} variant="outline" onClick={() => (entry.provider === 'imap' ? setImapOpen({ kind: 'shared' }) : setSharedOpen(entry.provider))}>
                {entry.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <ImapDialog state={imapOpen} onClose={() => setImapOpen(null)} onConnected={async (message) => { setImapOpen(null); setNotice({ tone: 'good', text: message }); await refresh(); bump(); }} />
      <SharedOAuthDialog provider={sharedOpen} onClose={() => setSharedOpen(null)} />

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirm?.emailAddress}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>The ERP will stop syncing, revoke its access where the provider allows it, and delete its stored credentials and its copy of this mailbox’s mail.</p>
                <p>Kept: links from ERP records (with the subject, sender and date), follow-ups, and the audit trail{confirm?.kind === 'shared' ? ', and the team’s assignments' : ''}. Drafts and scheduled messages from this mailbox are cancelled.</p>
                <p>Your mail itself is untouched at {confirm?.provider === 'gmail' ? 'Google' : confirm?.provider === 'microsoft' ? 'Microsoft' : 'your mail server'}.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={(event) => { event.preventDefault(); if (confirm) void disconnect(confirm); }}>
              {busy?.startsWith('disconnect') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImapDialog({ state, onClose, onConnected }: { state: { kind: 'personal' | 'shared'; accountId?: string; email?: string; presetId?: string } | null; onClose: () => void; onConnected: (message: string) => void }) {
  const { data } = useMailHub();
  const [presetId, setPresetId] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const presets = data?.imapServers ?? [];

  useEffect(() => {
    if (!state) return;
    setPresetId(state.presetId ?? presets[0]?.id ?? '');
    setEmail(state.email ?? (state.kind === 'personal' ? data?.user.email ?? '' : ''));
    setUsername('');
    setPassword('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const submit = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      const result = await mailApi.connectImap({ presetId, emailAddress: email, password, username: username || undefined, kind: state.kind, accountId: state.accountId });
      setPassword('');
      onConnected(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? `${caught.message}${(caught as { detail?: string }).detail ? ` — ${(caught as { detail?: string }).detail}` : ''}` : 'Could not connect.');
    } finally {
      setSaving(false);
    }
  };

  const preset = presets.find((entry) => entry.id === presetId);
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.accountId ? 'Reconnect' : state?.kind === 'shared' ? 'Connect a shared company mailbox' : 'Connect your company mailbox'}</DialogTitle>
          <DialogDescription>The ERP signs in to both the incoming and outgoing server to check the password before saving it, encrypted.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="space-y-1">
            <Label>Mail server</Label>
            <Select value={presetId} onValueChange={setPresetId} disabled={Boolean(state?.accountId)}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{presets.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent>
            </Select>
            {preset?.allowedDomains.length ? <p className="text-xs text-muted-foreground">For addresses at {preset.allowedDomains.join(', ')}</p> : null}
          </div>
          <div className="space-y-1"><Label htmlFor="imap-email">Email address</Label><Input id="imap-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={Boolean(state?.accountId)} /></div>
          <div className="space-y-1">
            <Label htmlFor="imap-user">Login name <span className="text-muted-foreground">(if different)</span></Label>
            <Input id="imap-user" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={preset?.usernameStyle === 'local-part' ? email.split('@')[0] : email} />
          </div>
          <div className="space-y-1"><Label htmlFor="imap-pass">Password</Label><Input id="imap-pass" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          {error && <p role="alert" className="rounded bg-rose-50 px-2 py-1.5 text-sm text-rose-700">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !presetId || !email || !password}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Connect</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SharedOAuthDialog({ provider, onClose }: { provider: 'gmail' | 'microsoft' | null; onClose: () => void }) {
  const { toast } = useToast();
  const [address, setAddress] = useState('');
  return (
    <Dialog open={Boolean(provider)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a shared {provider === 'gmail' ? 'Google' : 'Microsoft 365'} mailbox</DialogTitle>
          <DialogDescription>
            {provider === 'gmail'
              ? 'Sign in as the shared mailbox itself (for example accounts@company.com). Gmail cannot reach another mailbox through a personal login.'
              : 'Sign in with an account that has Full Access to the shared mailbox in Exchange. The ERP checks that access before connecting.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="shared-address">Shared mailbox address</Label>
          <Input id="shared-address" type="email" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="accounts@company.com" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!address.includes('@')}
            onClick={async () => {
              try {
                if (provider) await startOAuth(provider, { purpose: 'shared', address, returnTo: '/mail/settings/accounts' });
              } catch (caught) {
                toast({ variant: 'destructive', title: 'Cannot start sign-in', description: caught instanceof Error ? caught.message : undefined });
              }
            }}
          >
            Continue to sign-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
