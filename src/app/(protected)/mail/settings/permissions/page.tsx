'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Plus, Save, ShieldAlert, Trash2, UserPlus } from 'lucide-react';

import { useLoader, useMailHub } from '@/components/mail-hub/hooks';
import { EmptyState, ErrorNotice, PageHeader, Spinner, formatLong } from '@/components/mail-hub/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { mailApi, type SharedMailboxRow } from '@/lib/mail-hub/client';
import type { MailHubAdminSettings, MailImapServerPreset, MailMailboxMember } from '@/lib/mail-hub/model';
import { cn } from '@/lib/utils';

export default function MailPermissionsPage() {
  const { data } = useMailHub();
  if (!data) return null;
  const caps = data.capabilities;
  if (!caps.canAdministerConnections && !caps.canViewAudit) {
    return <EmptyState icon={<ShieldAlert className="h-9 w-9" />} title="Administrators only" body="This page needs Mail Hub › Settings › Administer or Mail Hub › Audit › View." />;
  }
  return (
    <Tabs defaultValue={caps.canAdministerConnections ? 'shared' : 'audit'} className="space-y-3">
      <PageHeader
        title="Permissions & sharing"
        description="Shared mailboxes, who may use them, the company mail servers, and the audit trail."
        actions={
          <TabsList className="flex-wrap">
            {caps.canAdministerConnections && <TabsTrigger value="shared">Shared mailboxes</TabsTrigger>}
            {caps.canAdministerConnections && <TabsTrigger value="connections">Connection settings</TabsTrigger>}
            <TabsTrigger value="audit">Audit trail</TabsTrigger>
            <TabsTrigger value="reference">How access works</TabsTrigger>
          </TabsList>
        }
      />
      {caps.canAdministerConnections && <TabsContent value="shared"><SharedMailboxes /></TabsContent>}
      {caps.canAdministerConnections && (
        <TabsContent value="connections" className="space-y-3">
          <RulesCheck />
          <ConnectionSettings />
        </TabsContent>
      )}
      <TabsContent value="audit"><AuditTrail /></TabsContent>
      <TabsContent value="reference"><Reference /></TabsContent>
    </Tabs>
  );
}

/* ── shared mailboxes ─────────────────────────────────────────────────────────────────────── */

function grantBadge(member: MailMailboxMember) {
  const status = member.providerGrant.read;
  const className = status === 'verified' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'missing' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800';
  return <Badge variant="outline" className={cn('text-[10px]', className)}>{status === 'verified' ? 'Provider: verified' : status === 'missing' ? 'Provider: no access' : status === 'error' ? 'Provider: check failed' : 'Provider: not verified'}</Badge>;
}

function SharedMailboxes() {
  const { value, loading, error, reload } = useLoader(() => mailApi.shared(), []);
  const [selected, setSelected] = useState<string | null>(null);
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !value) return <Spinner />;
  const mailboxes = value?.sharedMailboxes ?? [];
  if (!mailboxes.length) return <EmptyState title="No shared mailboxes yet" body="Connect one from Settings › Accounts › Connect a shared mailbox." />;
  const current = mailboxes.find((mailbox) => mailbox.id === (selected ?? mailboxes[0].id)) ?? mailboxes[0];
  return (
    <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ul className="space-y-1">
        {mailboxes.map((mailbox) => (
          <li key={mailbox.id}>
            <button type="button" onClick={() => setSelected(mailbox.id)} className={cn('w-full rounded-lg border px-3 py-2 text-left text-sm', mailbox.id === current.id ? 'border-indigo-300 bg-indigo-50' : 'bg-white hover:bg-slate-50')}>
              <p className="truncate font-medium">{mailbox.name}</p>
              <p className="truncate text-xs text-muted-foreground">{mailbox.address} · {mailbox.accountStatus}{mailbox.active ? '' : ' · disabled'}</p>
            </button>
          </li>
        ))}
      </ul>
      <MailboxEditor key={current.id} mailbox={current} onChanged={reload} />
    </div>
  );
}

function MailboxEditor({ mailbox, onChanged }: { mailbox: SharedMailboxRow; onChanged: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(mailbox.name);
  const [department, setDepartment] = useState(mailbox.departmentName ?? '');
  const [hours, setHours] = useState(String(mailbox.responseHours));
  const members = useLoader(() => mailApi.members(mailbox.id), [mailbox.id]);
  const [search, setSearch] = useState('');
  const users = useLoader(() => (search.length >= 2 ? mailApi.users(search) : Promise.resolve({ users: [] })), [search]);
  const [busy, setBusy] = useState<string | null>(null);

  const saveMailbox = async (patch: Record<string, unknown>) => {
    try {
      await mailApi.updateShared(mailbox.id, patch);
      toast({ title: 'Saved' });
      onChanged();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    }
  };

  const saveMember = async (userId: string, role: string, canSend: boolean) => {
    setBusy(userId);
    try {
      await mailApi.saveMember(mailbox.id, { userId, role, canSend });
      void members.reload();
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{mailbox.address}</CardTitle>
          <CardDescription>Synced through {mailbox.provider === 'gmail' ? 'Google' : mailbox.provider === 'microsoft' ? 'Microsoft 365' : 'IMAP'} · {mailbox.accountStatus}{mailbox.accountRecovery ? ` — ${mailbox.accountRecovery}` : ''}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
          <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="space-y-1"><Label>Department</Label><Input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="e.g. Accounts" /></div>
          <div className="space-y-1"><Label>Reply within (h)</Label><Input type="number" min={0} value={hours} onChange={(event) => setHours(event.target.value)} /></div>
          <Button onClick={() => saveMailbox({ name, departmentId: department || null, departmentName: department || null, responseHours: Number(hours) })}><Save className="mr-2 h-4 w-4" /> Save</Button>
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><Switch checked={mailbox.active} onCheckedChange={(active) => saveMailbox({ active })} /> Mailbox enabled</label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            Adding someone here is the ERP half of access. They also need the mailbox granted by the email provider to their own account — each member verifies that from Shared mailboxes, and it is re-checked every 12 hours. Readers can read; responders can reply, note and take work; managers can also edit routing rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-md">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Add a member — search by name or email" aria-label="Find a user" />
            {search.length >= 2 && (users.value?.users.length ?? 0) > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-white shadow">
                {users.value?.users.map((user) => (
                  <li key={user.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setSearch(''); void saveMember(user.id, 'responder', false); }}>
                      <UserPlus className="h-4 w-4 text-slate-400" /> {user.name} <span className="text-xs text-muted-foreground">{user.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {members.error && <ErrorNotice message={members.error} onRetry={members.reload} />}
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>May send</TableHead>
                  <TableHead>Provider grant</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.value?.members ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.userName}</TableCell>
                    <TableCell>
                      <Select value={member.role} onValueChange={(role) => saveMember(member.userId, role, member.canSend)} disabled={busy === member.userId}>
                        <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="reader">Reader</SelectItem>
                          <SelectItem value="responder">Responder</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Switch checked={member.canSend} onCheckedChange={(canSend) => saveMember(member.userId, member.role, canSend)} disabled={busy === member.userId || member.role === 'reader'} aria-label={`${member.userName} may send`} /></TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {grantBadge(member)}
                        <p className="max-w-[260px] text-[11px] text-muted-foreground">{member.providerGrant.detail ?? ''}{member.providerGrant.checkedAt ? ` (${formatLong(member.providerGrant.checkedAt)})` : ''}</p>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === member.userId}
                        onClick={async () => {
                          setBusy(member.userId);
                          try {
                            const result = await mailApi.verifyMember(mailbox.id, member.userId);
                            toast({ title: `Read: ${result.grant.read} · Send: ${result.grant.send}`, description: result.grant.detail ?? undefined });
                            void members.reload();
                          } catch (caught) {
                            toast({ variant: 'destructive', title: 'Check failed', description: caught instanceof Error ? caught.message : undefined });
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === member.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}<span className="ml-1">Re-check</span>
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${member.userName}`} onClick={async () => { if (window.confirm(`Remove ${member.userName} from ${mailbox.name}?`)) { await mailApi.removeMember(mailbox.id, member.userId).catch(() => {}); void members.reload(); } }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {members.value?.members.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No members yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── connection settings ──────────────────────────────────────────────────────────────────── */

const EMPTY_PRESET: MailImapServerPreset = { id: '', label: '', imapHost: '', imapPort: 993, imapSecurity: 'tls', smtpHost: '', smtpPort: 465, smtpSecurity: 'tls', usernameStyle: 'email', allowedDomains: [], smtpEnforcesSender: false, appendSentCopy: true };

function ConnectionSettings() {
  const { toast } = useToast();
  const { refresh } = useMailHub();
  const { value, loading, error, reload } = useLoader(() => mailApi.adminSettings(), []);
  const [settings, setSettings] = useState<MailHubAdminSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (value) setSettings(value.settings);
  }, [value]);
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading || !settings) return <Spinner />;

  const setPreset = (index: number, patch: Partial<MailImapServerPreset>) => setSettings({ ...settings, imapServers: settings.imapServers.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) });
  const save = async () => {
    setSaving(true);
    try {
      const result = await mailApi.saveAdminSettings(settings);
      setSettings(result.settings);
      await refresh();
      toast({ title: 'Connection settings saved' });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Server configuration</CardTitle><CardDescription>What this deployment has, by variable name. Values are never shown.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {value?.environment.map((entry) => (
            <div key={entry.provider} className="flex flex-wrap items-start gap-2">
              <Badge variant="outline" className={entry.available ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-800'}>{entry.provider}</Badge>
              <span className="text-xs text-muted-foreground">{entry.available ? 'Ready' : entry.problems.join(' ')}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Providers and retention</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {(['gmail', 'microsoft', 'imap'] as const).map((provider) => (
              <label key={provider} className="flex items-center gap-2 text-sm">
                <Switch checked={settings.enabledProviders.includes(provider)} onCheckedChange={(on) => setSettings({ ...settings, enabledProviders: on ? [...settings.enabledProviders, provider] : settings.enabledProviders.filter((entry) => entry !== provider) })} />
                {provider === 'gmail' ? 'Google' : provider === 'microsoft' ? 'Microsoft 365' : 'Company IMAP/SMTP'}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label>Sync the last (days)</Label><Input type="number" value={settings.defaultSyncWindowDays} onChange={(event) => setSettings({ ...settings, defaultSyncWindowDays: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label>Keep opened bodies (days)</Label><Input type="number" value={settings.bodyCacheDays} onChange={(event) => setSettings({ ...settings, bodyCacheDays: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label>Keep unsent uploads (days)</Label><Input type="number" value={settings.uploadRetentionDays} onChange={(event) => setSettings({ ...settings, uploadRetentionDays: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label>Attachment limit (MB)</Label><Input type="number" value={Math.round(settings.maxAttachmentBytes / 1024 / 1024)} onChange={(event) => setSettings({ ...settings, maxAttachmentBytes: Number(event.target.value) * 1024 * 1024 })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Only headers and snippets are kept for search. Bodies are cached only once opened, and deleted after the period above. Attachments are never stored — they are fetched from the provider on demand.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company mail servers (IMAP/SMTP)</CardTitle>
          <CardDescription>Users can connect only to servers listed here. TLS is required; certificates are verified.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.imapServers.map((preset, index) => (
            <div key={index} className="space-y-2 rounded-lg border p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1"><Label>Label</Label><Input value={preset.label} onChange={(event) => setPreset(index, { label: event.target.value })} placeholder="SEL mail (Roundcube)" /></div>
                <div className="space-y-1"><Label>Allowed domains</Label><Input value={preset.allowedDomains.join(', ')} onChange={(event) => setPreset(index, { allowedDomains: event.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="selindia.net" /></div>
                <div className="space-y-1">
                  <Label>Login is</Label>
                  <Select value={preset.usernameStyle} onValueChange={(value) => setPreset(index, { usernameStyle: value as 'email' | 'local-part' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="email">Full email address</SelectItem><SelectItem value="local-part">Part before @</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-6">
                <div className="space-y-1 sm:col-span-2"><Label>IMAP host</Label><Input value={preset.imapHost} onChange={(event) => setPreset(index, { imapHost: event.target.value })} /></div>
                <div className="space-y-1"><Label>Port</Label><Input type="number" value={preset.imapPort} onChange={(event) => setPreset(index, { imapPort: Number(event.target.value) })} /></div>
                <div className="space-y-1 sm:col-span-2"><Label>SMTP host</Label><Input value={preset.smtpHost} onChange={(event) => setPreset(index, { smtpHost: event.target.value })} /></div>
                <div className="space-y-1"><Label>Port</Label><Input type="number" value={preset.smtpPort} onChange={(event) => setPreset(index, { smtpPort: Number(event.target.value) })} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {(['imapSecurity', 'smtpSecurity'] as const).map((key) => (
                  <label key={key} className="flex items-center gap-2">
                    {key === 'imapSecurity' ? 'IMAP' : 'SMTP'}
                    <Select value={preset[key]} onValueChange={(value) => setPreset(index, { [key]: value as 'tls' | 'starttls' })}>
                      <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="tls">TLS</SelectItem><SelectItem value="starttls">STARTTLS</SelectItem></SelectContent>
                    </Select>
                  </label>
                ))}
                <label className="flex items-center gap-2"><Switch checked={Boolean(preset.smtpEnforcesSender)} onCheckedChange={(on) => setPreset(index, { smtpEnforcesSender: on })} /> SMTP rejects unauthorised senders</label>
                <label className="flex items-center gap-2"><Switch checked={preset.appendSentCopy !== false} onCheckedChange={(on) => setPreset(index, { appendSentCopy: on })} /> File a copy in Sent</label>
                <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => setSettings({ ...settings, imapServers: settings.imapServers.filter((_, i) => i !== index) })}><Trash2 className="mr-1 h-4 w-4" /> Remove</Button>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={() => setSettings({ ...settings, imapServers: [...settings.imapServers, { ...EMPTY_PRESET }] })}><Plus className="mr-2 h-4 w-4" /> Add a server</Button>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save connection settings</Button>
      </div>
    </div>
  );
}

/* ── audit ────────────────────────────────────────────────────────────────────────────────── */

function AuditTrail() {
  const { data } = useMailHub();
  const [mine, setMine] = useState(!data?.capabilities.canViewAudit);
  const { value, loading, error, reload } = useLoader(() => mailApi.audit({ mine }), [mine]);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Audit trail</CardTitle>
        <CardDescription>Append-only. Shared-mailbox activity (views, assignments, notes, sends) and configuration changes. Events about someone's personal mailbox are shown only to them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.capabilities.canViewAudit && <label className="flex items-center gap-2 text-sm"><Switch checked={mine} onCheckedChange={setMine} /> Only my own activity</label>}
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {loading && !value && <Spinner />}
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>What</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {(value?.events ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatLong(event.at)}</TableCell>
                  <TableCell className="text-sm">{event.actorName}</TableCell>
                  <TableCell className="text-sm">{event.summary}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{event.action}</Badge></TableCell>
                </TableRow>
              ))}
              {value?.events.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No events.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Tries to read every Mail Hub collection with the *browser's* Firestore client, as the signed-in
 * administrator. Every one must be refused: Mail Hub is only safe once the deny rules from
 * `firestore.rules` are in the live ruleset (which this project maintains in the console).
 */
function RulesCheck() {
  const [results, setResults] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const [{ collection, getDocs, limit, query }, { db }, { MAIL_HUB_COLLECTIONS }] = await Promise.all([
      import('firebase/firestore'),
      import('@/lib/firebase'),
      import('@/lib/mail-hub/model'),
    ]);
    const out: { name: string; ok: boolean; detail: string }[] = [];
    for (const name of Object.values(MAIL_HUB_COLLECTIONS)) {
      try {
        await getDocs(query(collection(db, name), limit(1)));
        out.push({ name, ok: false, detail: 'READABLE from the browser — deploy the Mail Hub rules before connecting mailboxes.' });
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        out.push({ name, ok: code === 'permission-denied', detail: code === 'permission-denied' ? 'Denied' : `Unexpected: ${code || String(error)}` });
      }
    }
    setResults(out);
    setRunning(false);
  };
  const failing = results?.filter((entry) => !entry.ok) ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Check security rules</CardTitle>
        <CardDescription>Every Mail Hub collection must refuse the browser. Run this after any change to the Firestore rules.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" onClick={run} disabled={running}>{running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check now</Button>
        {results && (
          <p className={cn('rounded-lg px-3 py-2 text-sm', failing.length ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
            {failing.length ? `${failing.length} collection(s) are readable from the browser.` : `All ${results.length} collections are closed to the browser.`}
          </p>
        )}
        {failing.map((entry) => <p key={entry.name} className="text-xs text-rose-700"><b>{entry.name}</b>: {entry.detail}</p>)}
      </CardContent>
    </Card>
  );
}

function Reference() {
  const rows: [string, string][] = [
    ['Mail Hub › Accounts › Connect', 'Connect your own mailboxes. Reading your own mail needs nothing more.'],
    ['Mail Hub › Compose › Send', 'Send mail at all — from your own mailbox, or (with the rows below) a shared one.'],
    ['Mail Hub › Shared Mail › Read', 'Read shared mailboxes you are a member of, once the provider has confirmed your access.'],
    ['Mail Hub › Shared Mail › Assign', 'Assign shared conversations to other members and change their status and deadline.'],
    ['Mail Hub › Shared Mail › Send', 'Send from shared mailboxes whose membership allows it — always through your own provider login.'],
    ['Mail Hub › Templates › View / Manage', 'Use department and organisation templates; Manage creates them and department signatures.'],
    ['Mail Hub › Reports › View', 'Shared-mailbox workload reports. Counts and times only.'],
    ['Mail Hub › Settings › Administer', 'Shared mailboxes, members, company mail servers, retention. Does not grant reading any mail.'],
    ['Mail Hub › AI › Use', 'Offers AI suggestions to people who also switch them on for themselves.'],
    ['Mail Hub › Audit › View', 'The shared-mailbox and configuration audit trail.'],
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">How access works</CardTitle>
        <CardDescription>
          A personal mailbox is readable only by the person who connected it — no ERP permission, including every administrator permission, opens it. A shared mailbox needs two independent yeses: an ERP membership with Shared Mail › Read, and the email provider confirming the member’s own account has been granted the mailbox. Either alone is refused.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Permission</TableHead><TableHead>What it allows</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(([permission, text]) => <TableRow key={permission}><TableCell className="whitespace-nowrap font-medium">{permission}</TableCell><TableCell className="text-sm">{text}</TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
