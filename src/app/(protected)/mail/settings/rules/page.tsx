'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2, Plus, Trash2 } from 'lucide-react';

import { useLoader, useMailHub } from '@/components/mail-hub/hooks';
import { EmptyState, ErrorNotice, PageHeader } from '@/components/mail-hub/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/mail-hub/client';
import type { MailMailboxMember, MailRoutingRule, MailUserSettings } from '@/lib/mail-hub/model';

export default function MailRulesPage() {
  const { data } = useMailHub();
  if (!data) return null;
  return (
    <div className="space-y-4">
      <PageHeader title="Rules & notifications" description="Your reminders and preferences, and routing rules for the shared mailboxes you manage." />
      <PersonalSettings />
      <RoutingRules />
    </div>
  );
}

function PersonalSettings() {
  const { toast } = useToast();
  const { data, refresh } = useMailHub();
  const [settings, setSettings] = useState<MailUserSettings | null>(data?.settings ?? null);
  const [domains, setDomains] = useState((data?.settings.trustedImageDomains ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data?.settings) {
      setSettings(data.settings);
      setDomains(data.settings.trustedImageDomains.join(', '));
    }
  }, [data?.settings]);
  if (!settings || !data) return null;

  const save = async (patch: Partial<MailUserSettings>) => {
    setSaving(true);
    try {
      const result = await mailApi.saveSettings({ ...settings, ...patch });
      setSettings(result.settings);
      await refresh();
      toast({ title: 'Saved' });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notifications and reading</CardTitle>
        <CardDescription>Reminders arrive in the ERP bell and as push notifications on your phone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">Tell me when a shared-mailbox conversation is assigned to me</span>
          <Switch checked={settings.notifyOnAssignment} onCheckedChange={(value) => save({ notifyOnAssignment: value })} disabled={saving} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Warn me before a reply is due</Label>
            <Select value={String(settings.deadlineWarningMinutes)} onValueChange={(value) => save({ deadlineWarningMinutes: Number(value) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[[0, 'Never'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [240, '4 hours before'], [1440, '1 day before']].map(([value, label]) => (
                  <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Remind me about overdue replies</Label>
            <Select value={String(settings.overdueReminderHours)} onValueChange={(value) => save({ overdueReminderHours: Number(value) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[[0, 'Once'], [4, 'Every 4 hours'], [8, 'Every 8 hours'], [24, 'Daily']].map(([value, label]) => (
                  <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trusted">Always load images from these sender domains</Label>
          <div className="flex gap-2">
            <Input id="trusted" value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="selindia.net, tata.com" />
            <Button variant="outline" disabled={saving} onClick={() => save({ trustedImageDomains: domains.split(/[,\s]+/).filter(Boolean) })}>Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">Remote images are blocked for everyone else: loading one tells the sender you opened their email.</p>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">Keyboard shortcuts (press ? in a mailbox to see them)</span>
          <Switch checked={settings.keyboardShortcuts} onCheckedChange={(value) => save({ keyboardShortcuts: value })} disabled={saving} />
        </label>
        {data.capabilities.canUseAi && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
            <label className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-violet-700" /> AI suggestions</span>
              <Switch checked={settings.aiOptIn} onCheckedChange={(value) => save({ aiOptIn: value })} disabled={saving} />
            </label>
            <p className="mt-1 text-xs text-slate-600">
              Off unless you turn it on. When on, you can ask for a summary or a draft reply of a conversation you are reading. Only that conversation is sent to the AI service, the suggestion is shown to you to edit, and nothing is ever sent without you pressing Send.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoutingRules() {
  const { toast } = useToast();
  const { data } = useMailHub();
  const shared = useLoader(() => mailApi.shared(), []);
  const manageable = (shared.value?.sharedMailboxes ?? []).filter((mailbox) => data?.capabilities.canAdministerConnections || (mailbox.membership?.role === 'manager' && data?.capabilities.canAssignShared));
  const [mailboxId, setMailboxId] = useState<string>('');
  const selected = mailboxId || manageable[0]?.id || '';
  const rules = useLoader(() => (selected ? mailApi.rules(selected) : Promise.resolve({ rules: [] as MailRoutingRule[] })), [selected]);
  const members = useLoader(() => (selected ? mailApi.members(selected) : Promise.resolve({ members: [] as MailMailboxMember[] })), [selected]);
  const [draft, setDraft] = useState<Partial<MailRoutingRule> | null>(null);

  if (shared.loading && !shared.value) return null;
  if (!manageable.length) return null;

  const save = async () => {
    if (!draft) return;
    try {
      await mailApi.saveRule({ ...draft, sharedMailboxId: selected });
      setDraft(null);
      void rules.reload();
      toast({ title: 'Rule saved' });
    } catch (caught) {
      toast({ variant: 'destructive', title: 'Not saved', description: caught instanceof Error ? caught.message : undefined });
    }
  };

  const responders = (members.value?.members ?? []).filter((member) => member.role !== 'reader');
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Shared-mailbox routing</CardTitle>
        <CardDescription>The first matching rule assigns each new inbound conversation and sets its reply deadline. Mail that matches no rule stays unassigned with the mailbox’s default deadline.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selected} onValueChange={setMailboxId}>
            <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>{manageable.map((mailbox) => <SelectItem key={mailbox.id} value={mailbox.id}>{mailbox.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setDraft({ name: '', enabled: true, order: (rules.value?.rules.length ?? 0) + 1, conditions: { fromContains: null, subjectContains: null, toContains: null }, actions: { assignToUserId: null, assignToUserName: null, deadlineHours: null } })}>
            <Plus className="mr-2 h-4 w-4" /> Add rule
          </Button>
        </div>
        {rules.error && <ErrorNotice message={rules.error} onRetry={rules.reload} />}
        {rules.value?.rules.length === 0 && !draft && <EmptyState title="No rules" />}
        <ul className="space-y-2">
          {(rules.value?.rules ?? []).map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="font-medium">{rule.order}. {rule.name}</span>
              <span className="text-muted-foreground">
                if {[rule.conditions.fromContains && `from contains “${rule.conditions.fromContains}”`, rule.conditions.toContains && `to contains “${rule.conditions.toContains}”`, rule.conditions.subjectContains && `subject contains “${rule.conditions.subjectContains}”`].filter(Boolean).join(' and ')}
                {' → '}
                {rule.actions.assignToUserName ? `assign to ${rule.actions.assignToUserName}` : 'leave unassigned'}
                {rule.actions.deadlineHours ? `, reply within ${rule.actions.deadlineHours} h` : ''}
              </span>
              {!rule.enabled && <span className="text-xs text-amber-700">(off)</span>}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setDraft(rule)}>Edit</Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${rule.name}`} onClick={async () => { await mailApi.deleteRule(rule.id).catch(() => {}); void rules.reload(); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
        {draft && (
          <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
              <div className="space-y-1"><Label>Name</Label><Input value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              <div className="space-y-1"><Label>Order</Label><Input type="number" min={1} value={draft.order ?? 1} onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['fromContains', 'toContains', 'subjectContains'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label>{key === 'fromContains' ? 'From contains' : key === 'toContains' ? 'To contains' : 'Subject contains'}</Label>
                  <Input value={draft.conditions?.[key] ?? ''} onChange={(event) => setDraft({ ...draft, conditions: { fromContains: null, toContains: null, subjectContains: null, ...draft.conditions, [key]: event.target.value || null } })} />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Assign to</Label>
                <Select value={draft.actions?.assignToUserId ?? 'none'} onValueChange={(value) => setDraft({ ...draft, actions: { assignToUserName: null, deadlineHours: null, ...draft.actions, assignToUserId: value === 'none' ? null : value } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nobody</SelectItem>
                    {responders.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.userName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Reply within (hours)</Label>
                <Input type="number" min={0} value={draft.actions?.deadlineHours ?? ''} onChange={(event) => setDraft({ ...draft, actions: { assignToUserId: null, assignToUserName: null, ...draft.actions, deadlineHours: event.target.value ? Number(event.target.value) : null } })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={draft.enabled !== false} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /> Enabled</label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save}>{rules.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save rule</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
