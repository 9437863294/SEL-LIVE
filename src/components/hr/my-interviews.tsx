'use client';

import { useMemo, useState } from 'react';
import { CalendarCheck, Loader2, Lock, ShieldCheck, Star, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  HR_COLLECTIONS,
  INTERVIEW_RATING_CRITERIA,
  INTERVIEW_RATING_LABELS,
  INTERVIEW_RECOMMENDATIONS,
  interviewFeedbackScore,
  type Candidate,
  type Interview,
  type InterviewFeedback,
  type InterviewRatings,
  type InterviewRecommendation,
} from '@/lib/hr-requirement';
import { HrControlError, submitInterviewFeedback } from '@/lib/hr-requirement-service';
import { HrAlertNotice, HrEmptyState, HrField, HrLoader, HrPageHeader, HrSection, HrStatusBadge, hrDialog } from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The interviewer's own screen, spec sections 25 and 26.
 *
 * Deliberately separate from the recruiter's interview list, and deliberately narrower. An
 * interviewer sees what they need to conduct the interview — the role, the candidate's experience
 * and skills, their resume — and nothing about salary, other panellists' scores, or what the
 * recruiter thinks. Showing an interviewer the rest is how a panel converges on the recruiter's
 * opinion instead of forming its own.
 *
 * Submitted feedback is append-only (control rule 63.6): the form closes after submission and only
 * an authorised reviser can add a correction, which is stored as a new revision beside the original.
 */

const formatWhen = (value: string | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function MyInterviews() {
  const { actor, loading: configLoading } = useHrConfig();
  const { rows: interviews, loading } = useHrCollection<Interview>(HR_COLLECTIONS.interviews);
  const { rows: feedback } = useHrCollection<InterviewFeedback>(HR_COLLECTIONS.interviewFeedback);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const [feedbackFor, setFeedbackFor] = useState<Interview | null>(null);

  const mine = useMemo(() => {
    if (!actor) return [];
    return interviews
      .filter(interview => (interview.interviewerIds || []).includes(actor.userId))
      .filter(interview => interview.status !== 'CANCELLED')
      .sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  }, [interviews, actor]);

  /** My submitted feedback per interview, with superseded revisions dropped. */
  const myFeedbackByInterview = useMemo(() => {
    if (!actor) return new Map<string, InterviewFeedback>();
    const mineOnly = feedback.filter(row => row.interviewerId === actor.userId);
    const superseded = new Set(mineOnly.map(row => row.revisionOf).filter(Boolean) as string[]);
    const map = new Map<string, InterviewFeedback>();
    for (const row of mineOnly) {
      if (superseded.has(row.id)) continue;
      map.set(row.interviewId, row);
    }
    return map;
  }, [feedback, actor]);

  const pending = mine.filter(interview => !myFeedbackByInterview.has(interview.id));
  const done = mine.filter(interview => myFeedbackByInterview.has(interview.id));

  if (loading || configLoading) return <HrLoader label="Loading your interviews…" />;

  const renderCard = (interview: Interview) => {
    const submitted = myFeedbackByInterview.get(interview.id);
    const candidate = candidates.find(row => row.id === interview.candidateId);

    return (
      <Card key={interview.id} className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-800">{interview.candidateName}</p>
                <HrStatusBadge status={interview.status} />
                {submitted && (
                  <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                    <ShieldCheck className="h-3 w-3" /> Feedback submitted
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {interview.designation || 'Role not stated'} · {interview.requirementNumber} · {interview.round}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-700">{formatWhen(interview.scheduledAt)}</p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              {interview.meetingLink && ['SCHEDULED', 'RESCHEDULED'].includes(interview.status) && (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={interview.meetingLink} target="_blank" rel="noreferrer">
                    <Video className="h-3.5 w-3.5" /> Join
                  </a>
                </Button>
              )}
              <Button size="sm" variant={submitted ? 'outline' : 'default'} className="gap-1.5" onClick={() => setFeedbackFor(interview)}>
                {submitted ? (
                  <>
                    <Lock className="h-3.5 w-3.5" /> View feedback
                  </>
                ) : (
                  <>
                    <Star className="h-3.5 w-3.5" /> Give feedback
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* The restricted candidate view of section 25 — no CTC, no panel scores. */}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 lg:grid-cols-4">
            <HrField label="Experience">
              {candidate?.totalExperienceYears ? `${candidate.totalExperienceYears} yrs` : '—'}
            </HrField>
            <HrField label="Current company">{candidate?.currentCompany || '—'}</HrField>
            <HrField label="Qualification">{candidate?.qualification || '—'}</HrField>
            <HrField label="Mode">
              {interview.mode}
              {interview.location ? ` · ${interview.location}` : ''}
            </HrField>
            {candidate?.skills?.length ? (
              <div className="col-span-2 lg:col-span-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {candidate.skills.slice(0, 12).map(skill => (
                    <Badge key={skill} variant="secondary" className="text-[10px]">{skill}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {candidate?.resumeUrl && (
              <div className="col-span-2 lg:col-span-4">
                <a href={candidate.resumeUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-700 underline">
                  Open resume
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <HrPageHeader
        title="My Interviews"
        description={`${pending.length} awaiting your feedback · ${done.length} completed`}
      />

      {mine.length === 0 ? (
        <HrEmptyState
          icon={CalendarCheck}
          title="No interviews assigned to you"
          description="When HR schedules you onto a panel, the interview and its feedback form appear here."
        />
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <HrSection title="Awaiting your feedback" description="Feedback cannot be changed once submitted.">
              <div className="space-y-3">{pending.map(renderCard)}</div>
            </HrSection>
          )}
          {done.length > 0 && (
            <HrSection title="Completed">
              <div className="space-y-3">{done.map(renderCard)}</div>
            </HrSection>
          )}
        </div>
      )}

      <FeedbackDialog
        interview={feedbackFor}
        existing={feedbackFor ? myFeedbackByInterview.get(feedbackFor.id) || null : null}
        onClose={() => setFeedbackFor(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Feedback form (spec sections 25, 26)
 * ---------------------------------------------------------------------------------------------- */

function FeedbackDialog({
  interview,
  existing,
  onClose,
}: {
  interview: Interview | null;
  existing: InterviewFeedback | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor, settings } = useHrConfig();
  const permissions = useHrPermissions();
  const [ratings, setRatings] = useState<InterviewRatings>({});
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | ''>('');
  const [strengths, setStrengths] = useState('');
  const [concerns, setConcerns] = useState('');
  const [comments, setComments] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [saving, setSaving] = useState(false);

  const canRevise = permissions.can('Revise Feedback', 'My Interviews') || settings.interviews.allowAuthorFeedbackRevision;
  const readOnly = Boolean(existing) && !revising;

  const activeRatings = readOnly ? existing?.ratings || {} : ratings;
  const activeRecommendation = readOnly ? existing?.recommendation : recommendation;
  const score = interviewFeedbackScore(activeRatings);

  const startRevision = () => {
    setRatings(existing?.ratings || {});
    setRecommendation(existing?.recommendation || '');
    setStrengths(existing?.strengths || '');
    setConcerns(existing?.concerns || '');
    setComments(existing?.comments || '');
    setRevising(true);
  };

  const submit = async () => {
    if (!actor || !interview) return;
    if (!recommendation) {
      toast({ title: 'Select your recommendation', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await submitInterviewFeedback(
        {
          interviewId: interview.id,
          ratings,
          recommendation,
          strengths,
          concerns,
          comments,
          revisionOf: revising && existing ? existing.id : undefined,
          revisionReason: revising ? revisionReason : undefined,
        },
        actor,
        { hasRevisePermission: permissions.can('Revise Feedback', 'My Interviews') },
      );
      toast({
        title: revising ? 'Revision recorded' : 'Feedback submitted',
        description: 'Your evaluation is timestamped and cannot be edited.',
      });
      setRatings({});
      setRecommendation('');
      setStrengths('');
      setConcerns('');
      setComments('');
      setRevising(false);
      setRevisionReason('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not submit feedback',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!interview) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{interview.candidateName} — {interview.round}</DialogTitle>
          <DialogDescription>
            {interview.designation || 'Role not stated'} · {interview.requirementNumber}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {readOnly && (
            <HrAlertNotice tone="blue" title="Submitted">
              Recorded {existing?.submittedAt?.toDate?.().toLocaleString('en-IN') || 'earlier'}
              {existing?.revisionNumber && existing.revisionNumber > 1 ? ` · revision ${existing.revisionNumber}` : ''}. Submitted
              feedback cannot be edited.
            </HrAlertNotice>
          )}

          {revising && (
            <div>
              <Label className="text-xs">Why is this being revised? *</Label>
              <Textarea rows={2} value={revisionReason} onChange={event => setRevisionReason(event.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The original evaluation is kept; this is stored beside it as a new revision.
              </p>
            </div>
          )}

          {/* 1–5 rating rows. Buttons rather than a slider: a panel member on a phone between two
              interviews should be able to tap seven scores without dragging anything. */}
          <div className="space-y-2">
            {INTERVIEW_RATING_CRITERIA.map(criterion => (
              <div key={criterion} className="flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-sm text-slate-700">{INTERVIEW_RATING_LABELS[criterion]}</p>
                <div className="flex shrink-0 gap-1">
                  {[1, 2, 3, 4, 5].map(value => {
                    const selected = Number(activeRatings[criterion]) === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={readOnly}
                        onClick={() => setRatings(current => ({ ...current, [criterion]: value }))}
                        className={cn(
                          'h-8 w-8 rounded-md border text-xs font-semibold transition-colors',
                          selected
                            ? 'border-indigo-500 bg-indigo-500 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300',
                          readOnly && 'cursor-default opacity-80',
                        )}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-600">Average score</span>
            <span className="text-sm font-semibold tabular-nums text-slate-800">{score || '—'}/5</span>
          </div>

          <div>
            <Label className="text-xs">Recommendation *</Label>
            <Select
              value={activeRecommendation || ''}
              onValueChange={value => setRecommendation(value as InterviewRecommendation)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {INTERVIEW_RECOMMENDATIONS.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Strengths</Label>
            <Textarea rows={2} value={readOnly ? existing?.strengths || '' : strengths} onChange={event => setStrengths(event.target.value)} disabled={readOnly} />
          </div>
          <div>
            <Label className="text-xs">Concerns</Label>
            <Textarea rows={2} value={readOnly ? existing?.concerns || '' : concerns} onChange={event => setConcerns(event.target.value)} disabled={readOnly} />
          </div>
          <div>
            <Label className="text-xs">
              Comments {(revising ? recommendation : activeRecommendation) === 'Not Recommended' && settings.interviews.requireCommentsOnRejection ? '*' : ''}
            </Label>
            <Textarea
              rows={3}
              value={readOnly ? existing?.comments || '' : comments}
              onChange={event => setComments(event.target.value)}
              disabled={readOnly}
              placeholder={
                (revising ? recommendation : recommendation) === 'Not Recommended'
                  ? 'Required when you do not recommend a candidate'
                  : undefined
              }
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {readOnly ? (
            canRevise ? (
              <Button variant="outline" onClick={startRevision}>Submit a revision</Button>
            ) : (
              <Button disabled className="gap-2">
                <Lock className="h-4 w-4" /> Locked
              </Button>
            )
          ) : (
            <Button onClick={submit} disabled={saving || !recommendation || (revising && !revisionReason.trim())} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {revising ? 'Submit revision' : 'Submit feedback'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
