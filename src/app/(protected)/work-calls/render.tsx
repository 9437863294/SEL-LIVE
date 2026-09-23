'use client';

/**
 * The look of the work-calls screen, kept in the module's own kit.
 *
 * Split out from `page.tsx` so the page file is the behaviour — dialling, confirming, the
 * visibility handling — and this file is the presentation. They were one file and it read as one
 * long function whose middle third was hand-rolled Tailwind that matched nothing else in the
 * application: a bespoke bottom sheet, a hand-drawn list, a header that was not `HrPageHeader`.
 *
 * Everything here now comes from the same components the Windows Agent screens use, so the page
 * inherits the module's spacing, its dark mode, its phone behaviour and any future change to
 * them. `HrDataList` in particular is why the contact list works on a handset: it renders cards
 * under `sm` and a table above it from one column definition.
 */

import { CalendarClock, Phone, PhoneOff, Search, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  hrDialog,
} from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import { WORK_CONTACT_TYPES, type WorkContact, type WorkContactType } from '@/lib/work-calls-model';

export const TYPE_LABELS: Record<WorkContactType, string> = {
  CLIENT: 'Client',
  SITE_MANAGER: 'Site manager',
  VENDOR: 'Vendor',
  CONTRACTOR: 'Contractor',
  EMPLOYEE: 'Employee',
  CONSULTANT: 'Consultant',
  BANK: 'Bank',
  GOVERNMENT: 'Government',
  OTHER: 'Other',
};

export type CallState = 'DIALLED' | 'COMPLETED' | 'CANCELLED' | 'NOT_CONFIRMED';

export interface ActiveCall {
  id: string;
  contactName: string;
  contactCompany: string | null;
  purpose: string | null;
  dialledAt: string;
}

export interface RecentCall extends ActiveCall {
  state: CallState;
  durationSeconds: number | null;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m${rest ? ` ${rest}s` : ''}`;
}

/* ── The call in progress, and the question that settles it ──────────────────────────────── */

export function ActiveCallCard({
  call,
  elapsed,
  onConfirm,
  onCancel,
  busy,
}: {
  call: ActiveCall;
  elapsed: number;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" aria-hidden />
          Call in progress
        </CardTitle>
        <CardDescription>
          {call.contactName}
          {call.contactCompany ? ` · ${call.contactCompany}` : ''}
          {' — dialled '}
          {new Date(call.dialledAt).toLocaleTimeString()}
          {call.purpose ? ` · ${call.purpose}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">Did the call happen?</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onConfirm} disabled={busy} className="gap-2">
            <Phone className="h-4 w-4" aria-hidden />
            Yes — about {formatDuration(elapsed)}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy} className="gap-2">
            <PhoneOff className="h-4 w-4" aria-hidden />
            No, it didn&apos;t connect
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          An unconfirmed call counts as no work time at all, so this is worth answering.
        </p>
      </CardContent>
    </Card>
  );
}

/* ── The directory ───────────────────────────────────────────────────────────────────────── */

export function DirectoryCard({
  query,
  onQueryChange,
  type,
  onTypeChange,
  contacts,
  loading,
  onCall,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  type: WorkContactType | 'ALL';
  onTypeChange: (value: WorkContactType | 'ALL') => void;
  contacts: WorkContact[];
  loading: boolean;
  onCall: (contact: WorkContact) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          Work directory
        </CardTitle>
        <CardDescription>
          Clients, site managers, vendors and consultants. Search by name, company, or the number
          itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Name, company, or the number"
            className="pl-9"
            inputMode="search"
            aria-label="Search the work directory"
          />
        </div>

        {/* Scrolls sideways on a phone rather than wrapping to four rows of chips. */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {(['ALL', ...WORK_CONTACT_TYPES] as const).map((value) => {
            const selected = type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onTypeChange(value as WorkContactType | 'ALL')}
                aria-pressed={selected}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {value === 'ALL' ? 'All' : TYPE_LABELS[value as WorkContactType]}
              </button>
            );
          })}
        </div>

        {loading ? (
          <HrLoader label="Loading the directory" />
        ) : contacts.length === 0 ? (
          <HrEmptyState
            icon={Users}
            title="No contacts match"
            description={
              query.trim()
                ? 'Try a shorter search, or ask an administrator to add them to the directory.'
                : 'The work directory is empty. An administrator can add clients, site managers and vendors.'
            }
          />
        ) : (
          <HrDataList
            rows={contacts}
            dense
            columns={[
              {
                header: 'Name',
                mobile: 'title',
                cell: (contact) => (
                  <span>
                    <span className="block font-medium">{contact.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[contact.company, contact.designation].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                ),
              },
              {
                header: 'Type',
                mobile: 'detail',
                cell: (contact) => (
                  <Badge variant="secondary" className="font-normal">
                    {TYPE_LABELS[contact.contactType]}
                  </Badge>
                ),
              },
              {
                header: '',
                align: 'right',
                mobile: 'footer',
                cell: (contact) => (
                  <Button size="sm" className="gap-1.5" onClick={() => onCall(contact)}>
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    Call
                  </Button>
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ── The day so far ──────────────────────────────────────────────────────────────────────── */

export function TodayCard({ calls }: { calls: RecentCall[] }) {
  const confirmed = calls.filter((call) => call.state === 'COMPLETED');
  const seconds = confirmed.reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
          Today
        </CardTitle>
        <CardDescription>
          Only confirmed calls count towards your work timeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <HrKpiCard label="Confirmed" value={String(confirmed.length)} tone="emerald" hint={`of ${calls.length} dialled`} />
          <HrKpiCard label="On calls" value={formatDuration(seconds)} tone="blue" hint="counted as work" />
        </div>

        <HrDataList
          rows={calls}
          dense
          empty="Nothing dialled yet today."
          columns={[
            {
              header: 'Contact',
              mobile: 'title',
              cell: (call) => (
                <span>
                  <span className="block font-medium">{call.contactName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(call.dialledAt).toLocaleTimeString()}
                    {call.purpose ? ` · ${call.purpose}` : ''}
                  </span>
                </span>
              ),
            },
            {
              header: 'Outcome',
              align: 'right',
              mobile: 'aside',
              cell: (call) =>
                call.state === 'COMPLETED' ? (
                  <span className="font-medium text-emerald-600">{formatDuration(call.durationSeconds)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {call.state === 'CANCELLED' ? 'Not connected' : 'Not counted'}
                  </span>
                ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

/* ── Purpose, asked before dialling ──────────────────────────────────────────────────────── */

export function PurposeDialog({
  contact,
  purpose,
  onPurposeChange,
  onDial,
  onClose,
  busy,
}: {
  contact: WorkContact | null;
  purpose: string;
  onPurposeChange: (value: string) => void;
  onDial: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={contact !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{contact?.name ?? 'Call'}</DialogTitle>
          <DialogDescription>
            {[contact?.company, contact?.mobile].filter(Boolean).join(' · ') || 'Work call'}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="space-y-1.5">
            <Label htmlFor="call-purpose">What is the call about? (optional)</Label>
            <Input
              id="call-purpose"
              value={purpose}
              onChange={(event) => onPurposeChange(event.target.value)}
              placeholder="Material approval, site progress…"
            />
            {/* Asked now because nobody types it afterwards. */}
            <p className="text-xs text-muted-foreground">
              Come back to this screen after the call to confirm how long it took.
            </p>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onDial} disabled={busy} className="gap-2">
            <Phone className="h-4 w-4" aria-hidden />
            Call {contact?.name ?? ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── The page frame ──────────────────────────────────────────────────────────────────────── */

export function WorkCallsFrame({
  error,
  children,
}: {
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Work calls"
        description="Call a contact from the company directory and the time appears on your work timeline."
      />

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {children}
    </div>
  );
}
