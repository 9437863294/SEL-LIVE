'use client';

/**
 * The ERP side of a conversation: record links, follow-ups, assignment and internal notes.
 *
 * Internal notes are styled unmistakably (amber, "Internal — never sent") and live in a panel
 * separate from the composer. They are posted to their own API; there is no control anywhere that
 * moves a note's text into a reply, and the compose API would drop it if one existed.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarPlus, Link2, Loader2, Lock, Plus, StickyNote, UserPlus, X } from 'lucide-react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { mailApi, type ThreadDetail } from '@/lib/mail-hub/client';
import { MAIL_LINK_RECORD_LABELS, MAIL_LINK_RECORD_TYPES, type MailLinkRecordType, type MailMailboxMember, type MailPriority } from '@/lib/mail-hub/model';
import { cn } from '@/lib/utils';
import { INTERNAL_NOTE_CLASS, formatLong, fromLocalInput, toLocalInput } from './ui';

function Section({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white/80 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ── links ────────────────────────────────────────────────────────────────────────────────── */

export function LinksPanel({ detail, onChange }: { detail: ThreadDetail; onChange: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Linked records"
      icon={<Link2 className="h-3.5 w-3.5" />}
      action={
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Link
        </Button>
      }
    >
      {detail.links.length === 0 ? (
        <p className="text-xs text-muted-foreground">Link this conversation to a project, vendor, PO, invoice, approval, task or meeting.</p>
      ) : (
        <ul className="space-y-1.5">
          {detail.links.map((link) => (
            <li key={link.id} className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="shrink-0 text-[10px]">{MAIL_LINK_RECORD_LABELS[link.recordType]}</Badge>
              {link.href ? (
                <Link href={link.href} className="min-w-0 flex-1 truncate text-indigo-700 hover:underline">{link.recordLabel}</Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">{link.recordLabel}</span>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                aria-label={`Unlink ${link.recordLabel}`}
                onClick={async () => {
                  try {
                    await mailApi.removeLink(link.id);
                    onChange();
                  } catch (error) {
                    toast({ variant: 'destructive', title: 'Could not unlink', description: error instanceof Error ? error.message : undefined });
                  }
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LinkDialog open={open} onOpenChange={setOpen} threadId={detail.thread.id} onLinked={onChange} />
    </Section>
  );
}

function LinkDialog({ open, onOpenChange, threadId, onLinked }: { open: boolean; onOpenChange: (open: boolean) => void; threadId: string; onLinked: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState<MailLinkRecordType>('project');
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<{ id: string; path: string; label: string; secondary: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        setRecords((await mailApi.records(type, query)).records);
        setError(null);
      } catch (caught) {
        setRecords([]);
        setError(caught instanceof Error ? caught.message : 'Could not search.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, type, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to an ERP record</DialogTitle>
          <DialogDescription>Only records in modules you can open are listed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[170px_1fr]">
          <Select value={type} onValueChange={(value) => setType(value as MailLinkRecordType)}>
            <SelectTrigger aria-label="Record type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAIL_LINK_RECORD_TYPES.map((entry) => (
                <SelectItem key={entry} value={entry}>{MAIL_LINK_RECORD_LABELS[entry]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input autoFocus placeholder="Search by name or number" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="max-h-72 min-h-24 overflow-y-auto rounded-lg border">
          {loading && <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>}
          {!loading && error && <p className="p-3 text-sm text-rose-700">{error}</p>}
          {!loading && !error && records.length === 0 && <p className="p-3 text-sm text-muted-foreground">No matching records.</p>}
          {!loading &&
            records.map((record) => (
              <button
                key={record.path}
                type="button"
                className="flex w-full flex-col items-start border-b px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                onClick={async () => {
                  try {
                    await mailApi.addLink(threadId, { recordType: type, recordPath: record.path });
                    toast({ title: 'Linked', description: record.label });
                    onOpenChange(false);
                    onLinked();
                  } catch (caught) {
                    toast({ variant: 'destructive', title: 'Could not link', description: caught instanceof Error ? caught.message : undefined });
                  }
                }}
              >
                <span className="text-sm font-medium">{record.label}</span>
                {record.secondary && <span className="text-xs text-muted-foreground">{record.secondary}</span>}
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── follow-ups ───────────────────────────────────────────────────────────────────────────── */

const PRIORITIES: { value: MailPriority; label: string; officeHub: 'Low' | 'Medium' | 'High' | 'Critical' }[] = [
  { value: 'low', label: 'Low', officeHub: 'Low' },
  { value: 'normal', label: 'Normal', officeHub: 'Medium' },
  { value: 'high', label: 'High', officeHub: 'High' },
  { value: 'urgent', label: 'Urgent', officeHub: 'Critical' },
];

const REMINDERS = [
  { value: 15, label: '15 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

export function FollowUpsPanel({ detail, members, onChange }: { detail: ThreadDetail; members: MailMailboxMember[]; onChange: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Follow-ups"
      icon={<CalendarPlus className="h-3.5 w-3.5" />}
      action={
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      }
    >
      {detail.followUps.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing scheduled. Add a follow-up to be reminded before it is due.</p>
      ) : (
        <ul className="space-y-1.5">
          {detail.followUps.map((followUp) => (
            <li key={followUp.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={followUp.status === 'done'}
                aria-label={`Mark "${followUp.title}" done`}
                onCheckedChange={async (checked) => {
                  try {
                    await mailApi.updateFollowUp(followUp.id, { status: checked ? 'done' : 'open' });
                    onChange();
                  } catch (error) {
                    toast({ variant: 'destructive', title: 'Could not update', description: error instanceof Error ? error.message : undefined });
                  }
                }}
              />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate', followUp.status === 'done' && 'text-muted-foreground line-through')}>{followUp.title}</p>
                <p className="text-xs text-muted-foreground">
                  {followUp.ownerName} · due {formatLong(followUp.dueAt)} · {followUp.priority}
                  {followUp.officeHubTaskId && (
                    <>
                      {' · '}
                      <Link className="text-indigo-700 hover:underline" href={`/office-hub/tasks/${followUp.officeHubTaskId}`}>Office Hub task</Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FollowUpDialog open={open} onOpenChange={setOpen} detail={detail} members={members} onCreated={onChange} />
    </Section>
  );
}

function FollowUpDialog({ open, onOpenChange, detail, members, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; detail: ThreadDetail; members: MailMailboxMember[]; onCreated: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const canCreateOfficeHubTask = can('Create', 'Office Hub.Tasks');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<MailPriority>('normal');
  const [owner, setOwner] = useState<string>('');
  const [reminders, setReminders] = useState<number[]>([60]);
  const [alsoTask, setAlsoTask] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(`Follow up: ${detail.thread.subject}`.slice(0, 200));
    setDue(toLocalInput(new Date(Date.now() + 86_400_000).toISOString()));
    setOwner(user?.id ?? '');
    setAlsoTask(false);
  }, [open, detail.thread.subject, user?.id]);

  const assignable = detail.sharedMailbox && detail.access.canAssign ? members.filter((member) => member.role !== 'reader') : [];

  const save = async () => {
    const dueAt = fromLocalInput(due);
    if (!title.trim() || !dueAt) {
      toast({ variant: 'destructive', title: 'A title and due date are required.' });
      return;
    }
    setSaving(true);
    try {
      let officeHubTaskId: string | null = null;
      if (alsoTask && canCreateOfficeHubTask) {
        // Office Hub creates its own task through its own service — its numbering, permissions,
        // notifications and reminders all apply. Mail Hub only keeps the id.
        const { createTask, officeHubActorFromUser } = await import('@/lib/office-hub-service');
        const actor = officeHubActorFromUser(user);
        if (actor) {
          const ownerMember = members.find((member) => member.userId === owner);
          officeHubTaskId = await createTask(actor, {
            title: title.trim(),
            description: `From email: "${detail.thread.subject}" (${detail.account.emailAddress}). Open in Mail Hub: /mail/${detail.sharedMailbox ? 'shared' : 'inbox'}?thread=${detail.thread.id}`,
            assigneeId: owner || user?.id || null,
            assigneeName: ownerMember?.userName ?? user?.name ?? null,
            dueDate: dueAt.slice(0, 10),
            priority: PRIORITIES.find((entry) => entry.value === priority)?.officeHub ?? 'Medium',
          });
        }
      }
      await mailApi.addFollowUp(detail.thread.id, { title: title.trim(), ownerId: owner || null, dueAt, priority, reminderOffsets: reminders, officeHubTaskId });
      toast({ title: 'Follow-up added' });
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not add the follow-up', description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Follow up on this email</DialogTitle>
          <DialogDescription>You will be reminded before it is due.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="fu-title">Title</Label>
            <Input id="fu-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fu-due">Due</Label>
              <Input id="fu-due" type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as MailPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {assignable.length > 0 && (
            <div className="space-y-1">
              <Label>Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger><SelectValue placeholder="Me" /></SelectTrigger>
                <SelectContent>
                  {user?.id && <SelectItem value={user.id}>Me</SelectItem>}
                  {assignable.filter((member) => member.userId !== user?.id).map((member) => <SelectItem key={member.userId} value={member.userId}>{member.userName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Reminders</legend>
            <div className="flex flex-wrap gap-3">
              {REMINDERS.map((entry) => (
                <label key={entry.value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={reminders.includes(entry.value)} onCheckedChange={(checked) => setReminders((current) => (checked ? [...current, entry.value] : current.filter((value) => value !== entry.value)))} />
                  {entry.label}
                </label>
              ))}
            </div>
          </fieldset>
          {canCreateOfficeHubTask && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={alsoTask} onCheckedChange={(checked) => setAlsoTask(Boolean(checked))} /> Also create an Office Hub task
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── assignment (shared mailboxes) ────────────────────────────────────────────────────────── */

export function AssignmentPanel({ detail, members, onChange }: { detail: ThreadDetail; members: MailMailboxMember[]; onChange: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const assignment = detail.thread.assignment;
  const mine = assignment?.assigneeId === user?.id;
  const canEdit = detail.access.canAssign || (detail.access.canWorkOwnAssignment && (mine || !assignment?.assigneeId));
  const responders = members.filter((member) => member.role !== 'reader');

  const update = async (input: { assigneeId?: string | null; status?: string; dueAt?: string | null }) => {
    setSaving(true);
    try {
      await mailApi.assignment(detail.thread.id, input);
      onChange();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not update the assignment', description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Assignment" icon={<UserPlus className="h-3.5 w-3.5" />} action={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Assignee</Label>
          {detail.access.canAssign ? (
            <Select value={assignment?.assigneeId ?? 'none'} onValueChange={(value) => update({ assigneeId: value === 'none' ? null : value })} disabled={saving}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {responders.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.userName}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{assignment?.assigneeName ?? 'Unassigned'}</span>
              {!assignment?.assigneeId && detail.access.canWorkOwnAssignment && user?.id && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => update({ assigneeId: user.id })}>Take it</Button>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={assignment?.status ?? 'open'} onValueChange={(value) => update({ status: value })} disabled={!canEdit || saving}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Waiting on others</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="reply-due">Reply due</Label>
            <Input
              id="reply-due"
              type="datetime-local"
              className="h-8 text-xs"
              disabled={!canEdit || saving}
              defaultValue={toLocalInput(assignment?.dueAt)}
              key={assignment?.dueAt ?? 'none'}
              onBlur={(event) => {
                const next = fromLocalInput(event.target.value);
                if (next !== (assignment?.dueAt ?? null)) void update({ dueAt: next });
              }}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── internal notes ───────────────────────────────────────────────────────────────────────── */

export function NotesPanel({ detail, members, onChange }: { detail: ThreadDetail; members: MailMailboxMember[]; onChange: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const mentions = members.filter((member) => draft.includes(`@${member.userName}`)).map((member) => member.userId);

  return (
    <Section title="Internal notes" icon={<StickyNote className="h-3.5 w-3.5" />}>
      <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-amber-800">
        <Lock className="h-3 w-3" /> Internal — never sent to anyone outside the ERP
      </p>
      {detail.notes.length > 0 && (
        <ul className="mb-2 space-y-2">
          {detail.notes.map((note) => (
            <li key={note.id} className={cn('rounded-lg border px-2.5 py-2 text-sm', INTERNAL_NOTE_CLASS)}>
              <p className="whitespace-pre-wrap break-words">{note.body}</p>
              <p className="mt-1 text-[11px] text-amber-900/70">{note.authorName} · {formatLong(note.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {detail.access.canAddNotes ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={detail.sharedMailbox ? 'Note for your team. Type @Name to notify a member.' : 'A private note for yourself.'}
            className={cn('min-h-20 text-sm', INTERNAL_NOTE_CLASS)}
            maxLength={5000}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!draft.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await mailApi.addNote(detail.thread.id, draft, mentions);
                  setDraft('');
                  onChange();
                } catch (error) {
                  toast({ variant: 'destructive', title: 'Could not add the note', description: error instanceof Error ? error.message : undefined });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add internal note
            </Button>
          </div>
        </div>
      ) : (
        detail.notes.length === 0 && <p className="text-xs text-muted-foreground">No notes.</p>
      )}
    </Section>
  );
}

