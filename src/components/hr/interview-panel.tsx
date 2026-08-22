'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, CalendarPlus, Loader2, Video, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  INTERVIEW_MODES,
  INTERVIEW_ROUNDS,
  PIPELINE_STAGES,
  type CandidateApplication,
  type HrRequirement,
  type Interview,
  type InterviewMode,
  type InterviewRound,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  cancelInterview,
  rescheduleInterview,
  scheduleInterview,
} from '@/lib/hr-requirement-service';
import {
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  HrStatusBadge,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Interview management, spec section 24.
 *
 * Scoped by `requirementId` for the workspace's Interviews tab and unscoped for the standalone
 * screen, the same arrangement the pipeline board uses. Interviewer *feedback* is deliberately not
 * here — it lives on the interviewer's own screen (`my-interviews.tsx`), because section 25 gives
 * interviewers a restricted view of the candidate and section 26 forbids the recruiter from editing
 * what they submit.
 */

const formatWhen = (value: string | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function InterviewPanel({
  requirementId,
  embedded = false,
}: {
  requirementId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { users, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: interviews, loading } = useHrCollection<Interview>(HR_COLLECTIONS.interviews);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<Interview | null>(null);
  const [cancelFor, setCancelFor] = useState<Interview | null>(null);
  const [statusFilter, setStatusFilter] = useState('upcoming');

  const visible = useMemo(() => {
    const now = new Date().getTime();
    return interviews
      .filter(interview => (requirementId ? interview.requirementId === requirementId : true))
      .filter(interview => {
        const when = new Date(interview.scheduledAt || '').getTime();
        switch (statusFilter) {
          case 'upcoming':
            return ['SCHEDULED', 'RESCHEDULED'].includes(interview.status) && (Number.isNaN(when) || when >= now - 86_400_000);
          case 'feedback-pending':
            return interview.status === 'FEEDBACK_PENDING' || (interview.status === 'COMPLETED' && (interview.averageScore || 0) === 0);
          case 'completed':
            return interview.status === 'COMPLETED';
          case 'cancelled':
            return ['CANCELLED', 'NO_SHOW'].includes(interview.status);
          default:
            return true;
        }
      })
      .sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  }, [interviews, requirementId, statusFilter]);

  const columns: Array<HrListColumn<Interview>> = [
    {
      header: 'Candidate',
      mobile: 'title',
      cell: row => (
        <Link href={`/hr/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
          {row.candidateName}
        </Link>
      ),
    },
    {
      header: 'Requirement',
      mobile: 'title',
      className: requirementId ? 'hidden' : undefined,
      cell: row => (
        <Link href={`/hr/requirements/${row.requirementId}`} className="text-xs text-muted-foreground hover:underline">
          {row.requirementNumber} · {row.designation}
        </Link>
      ),
    },
    { header: 'Round', cell: row => `${row.round}${row.roundNumber ? ` (${row.roundNumber})` : ''}` },
    { header: 'Mode', className: 'hidden lg:table-cell', cell: row => row.mode },
    { header: 'Scheduled', cell: row => formatWhen(row.scheduledAt) },
    {
      header: 'Panel',
      className: 'hidden xl:table-cell',
      cell: row => (row.interviewerNames?.length ? row.interviewerNames.join(', ') : `${row.interviewerIds?.length || 0} interviewer(s)`),
    },
    {
      header: 'Score',
      align: 'right',
      cell: row =>
        row.averageScore ? (
          <span className="tabular-nums font-medium">{row.averageScore}/5</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Panel view',
      className: 'hidden lg:table-cell',
      cell: row =>
        row.panelRecommendation ? (
          <span className="inline-flex items-center gap-1.5">
            {row.panelRecommendation}
            {row.hasDissent && (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                dissent
              </Badge>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row => {
        const live = ['SCHEDULED', 'RESCHEDULED'].includes(row.status);
        if (!live) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex gap-1.5">
            {row.meetingLink && (
              <Button asChild size="sm" variant="outline" className="gap-1">
                <a href={row.meetingLink} target="_blank" rel="noreferrer">
                  <Video className="h-3.5 w-3.5" /> Join
                </a>
              </Button>
            )}
            {permissions.can('Reschedule', 'Interviews') && (
              <Button size="sm" variant="outline" onClick={() => setRescheduleFor(row)}>
                Reschedule
              </Button>
            )}
            {permissions.can('Cancel', 'Interviews') && (
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setCancelFor(row)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading interviews…" />;

  return (
    <div>
      {!embedded && (
        <HrPageHeader
          title="Interviews"
          description={`${visible.length} ${visible.length === 1 ? 'interview' : 'interviews'}`}
          actions={
            permissions.can('Schedule', 'Interviews') && (
              <Button className="gap-2" onClick={() => setScheduleOpen(true)}>
                <CalendarPlus className="h-4 w-4" /> Schedule Interview
              </Button>
            )
          }
        />
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-56">
          <Label className="text-xs">Show</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="feedback-pending">Feedback pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled / no show</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {embedded && permissions.can('Schedule', 'Interviews') && (
          <Button className="gap-2" onClick={() => setScheduleOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        )}
      </div>

      <HrDataList
        rows={visible}
        columns={columns}
        empty={
          <HrEmptyState
            icon={CalendarCheck}
            title="No interviews to show"
            description="Shortlisted candidates can be scheduled for an interview round."
            action={
              permissions.can('Schedule', 'Interviews') ? (
                <Button size="sm" className="gap-2" onClick={() => setScheduleOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule Interview
                </Button>
              ) : undefined
            }
          />
        }
      />

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        requirementId={requirementId}
        applications={applications}
        requirements={requirements}
        users={users}
      />

      {/* Reschedule and cancel both demand a reason, so the interview history explains itself. */}
      <ReasonDialog
        open={Boolean(rescheduleFor)}
        title="Reschedule interview"
        description={rescheduleFor ? `${rescheduleFor.round} for ${rescheduleFor.candidateName}` : ''}
        withDateTime
        confirmLabel="Reschedule"
        onClose={() => setRescheduleFor(null)}
        onConfirm={async (reason, scheduledAt) => {
          if (!actor || !rescheduleFor) return;
          try {
            await rescheduleInterview(rescheduleFor.id, { scheduledAt: scheduledAt || '', reason }, actor);
            toast({ title: 'Interview rescheduled' });
            setRescheduleFor(null);
          } catch (error) {
            toast({
              title: 'Could not reschedule',
              description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
              variant: 'destructive',
            });
          }
        }}
      />

      <ReasonDialog
        open={Boolean(cancelFor)}
        title="Cancel interview"
        description={cancelFor ? `${cancelFor.round} for ${cancelFor.candidateName}` : ''}
        confirmLabel="Cancel interview"
        destructive
        onClose={() => setCancelFor(null)}
        onConfirm={async reason => {
          if (!actor || !cancelFor) return;
          try {
            await cancelInterview(cancelFor.id, reason, actor);
            toast({ title: 'Interview cancelled' });
            setCancelFor(null);
          } catch (error) {
            toast({
              title: 'Could not cancel',
              description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
              variant: 'destructive',
            });
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Schedule an interview (spec section 24)
 * ---------------------------------------------------------------------------------------------- */

function ScheduleDialog({
  open,
  onOpenChange,
  requirementId,
  applications,
  requirements,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirementId?: string;
  applications: CandidateApplication[];
  requirements: HrRequirement[];
  users: Array<{ id: string; name: string }>;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [applicationId, setApplicationId] = useState('');
  const [round, setRound] = useState<InterviewRound>('HR Round');
  const [mode, setMode] = useState<InterviewMode>('In Person');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  /**
   * Only candidates who are actually interviewable are listed: someone still at NEW has not been
   * screened, and someone already at OFFERED does not need another round. Offering the whole
   * pipeline here is how an interview gets booked against a candidate who has already joined.
   */
  const eligible = useMemo(() => {
    const interviewable: Array<CandidateApplication['stage']> = [
      'SCREENING', 'SHORTLISTED', 'INTERVIEW_1', 'INTERVIEW_2', 'FINAL_INTERVIEW',
    ];
    return applications
      .filter(application => (requirementId ? application.requirementId === requirementId : true))
      .filter(application => interviewable.includes(application.stage))
      .sort((a, b) => (a.candidateName || '').localeCompare(b.candidateName || ''));
  }, [applications, requirementId]);

  const toggleInterviewer = (userId: string) =>
    setInterviewerIds(current => (current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]));

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await scheduleInterview(
        {
          applicationId,
          round,
          mode,
          scheduledAt,
          durationMinutes: Number(durationMinutes) || 45,
          location,
          meetingLink,
          interviewerIds,
          interviewerNames: interviewerIds.map(id => users.find(row => row.id === id)?.name || 'Interviewer'),
        },
        actor,
      );
      toast({ title: 'Interview scheduled', description: 'The panel has been notified.' });
      setApplicationId('');
      setInterviewerIds([]);
      setScheduledAt('');
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Could not schedule',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Schedule interview</DialogTitle>
          <DialogDescription>Spec section 24 — candidate, round, panel, mode and time.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyGrid}>
          <div className="sm:col-span-2">
            <Label className="text-xs">Candidate *</Label>
            <Select value={applicationId} onValueChange={setApplicationId}>
              <SelectTrigger>
                <SelectValue placeholder={eligible.length ? 'Select a shortlisted candidate' : 'No candidates are ready for interview'} />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {eligible.map(application => {
                  const requirement = requirements.find(row => row.id === application.requirementId);
                  return (
                    <SelectItem key={application.id} value={application.id}>
                      {application.candidateName} · {requirement?.requirementNumber || application.requirementNumber} ·{' '}
                      {application.stage.replace(/_/g, ' ').toLowerCase()}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Round *</Label>
            <Select value={round} onValueChange={value => setRound(value as InterviewRound)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVIEW_ROUNDS.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode *</Label>
            <Select value={mode} onValueChange={value => setMode(value as InterviewMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVIEW_MODES.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date &amp; time *</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Duration (minutes)</Label>
            <Input type="number" inputMode="decimal" value={durationMinutes} onChange={event => setDurationMinutes(event.target.value)} />
          </div>
          {mode === 'Video' ? (
            <div className="sm:col-span-2">
              <Label className="text-xs">Meeting link</Label>
              <Input value={meetingLink} onChange={event => setMeetingLink(event.target.value)} placeholder="https://…" />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <Label className="text-xs">Location</Label>
              <Input value={location} onChange={event => setLocation(event.target.value)} placeholder="Office / site / room" />
            </div>
          )}

          <div className="sm:col-span-2">
            <Label className="text-xs">Panel * ({interviewerIds.length} selected)</Label>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {users.map(row => (
                <label key={row.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={interviewerIds.includes(row.id)}
                    onChange={() => toggleInterviewer(row.id)}
                  />
                  <span className="text-sm">{row.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !applicationId || interviewerIds.length === 0 || !scheduledAt} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A reason-capture dialog, shared by the actions in this module that must not happen silently.
 *
 * Exported because the workspace's hold, cancel and closure actions need exactly the same thing,
 * and four near-identical dialogs is four places for the "reason is mandatory" rule to be forgotten.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  withDateTime = false,
  withDate = false,
  reasonLabel = 'Reason',
  placeholder,
  optional = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  withDateTime?: boolean;
  withDate?: boolean;
  reasonLabel?: string;
  placeholder?: string;
  optional?: boolean;
  onClose: () => void;
  onConfirm: (reason: string, dateValue?: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm(reason, dateValue);
      setReason('');
      setDateValue('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className={hrDialog.body}>
          {(withDateTime || withDate) && (
            <div>
              <Label className="text-xs">{withDateTime ? 'New date & time *' : 'Date *'}</Label>
              <Input
                type={withDateTime ? 'datetime-local' : 'date'}
                value={dateValue}
                onChange={event => setDateValue(event.target.value)}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">
              {reasonLabel} {optional ? '' : '*'}
            </Label>
            <Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder={placeholder} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={submit}
            disabled={saving || (!optional && !reason.trim()) || ((withDateTime || withDate) && !dateValue)}
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Live pipeline stages, exported for the screens that need to know what "still in play" means. */
export const LIVE_PIPELINE_STAGES = PIPELINE_STAGES;
