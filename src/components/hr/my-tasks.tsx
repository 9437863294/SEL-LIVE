'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  CircleDollarSign,
  Clock,
  FileSignature,
  FileText,
  Star,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  HR_COLLECTIONS,
  PENDING_APPROVAL_STATUSES,
  evaluateRequirementSla,
  isOpenRequirementStatus,
  summarizeDocumentChecklist,
  type CompensationApproval,
  type HrOffer,
  type HrRequirement,
  type Interview,
  type InterviewFeedback,
  type JoiningRecord,
  type PreJoiningDocument,
} from '@/lib/hr-requirement';
import { HrLoader, HrPageHeader } from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * "My HR Tasks" — spec section 55.
 *
 * A task queue instead of making people check seven screens to find out whether anything needs them.
 * Every tile is scoped to the signed-in user wherever the work is assignable — approvals they hold,
 * interviews they sit on — and to the organisation where it is a shared queue, like documents pending
 * before a joining. A tile with a count of zero is hidden rather than shown greyed out: an empty
 * list should read as "nothing to do", not as a wall of zeroes.
 */

interface Task {
  label: string;
  count: number;
  href: string;
  icon: React.ElementType;
  tone: string;
  hint?: string;
}

export default function MyHrTasks() {
  const { settings, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: interviews } = useHrCollection<Interview>(HR_COLLECTIONS.interviews);
  const { rows: feedback } = useHrCollection<InterviewFeedback>(HR_COLLECTIONS.interviewFeedback);
  const { rows: compensation } = useHrCollection<CompensationApproval>(HR_COLLECTIONS.compensationApprovals);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);
  const { rows: documents } = useHrCollection<PreJoiningDocument>(HR_COLLECTIONS.preJoining);

  const tasks = useMemo<Task[]>(() => {
    const userId = actor?.userId || '';
    // Read the clock once for the whole pass, so every "this week" figure below is measured against
    // the same instant rather than drifting between filters.
    const nowMs = new Date().getTime();
    const weekAheadMs = nowMs + 7 * 86_400_000;

    const myApprovals = requirements.filter(
      row => PENDING_APPROVAL_STATUSES.includes(row.status) && (row.pendingApproverIds || []).includes(userId),
    ).length;

    /** Interviews I sit on where I have not submitted feedback (spec sections 25, 49). */
    const mySubmitted = new Set(
      feedback.filter(row => row.interviewerId === userId && row.submitted).map(row => row.interviewId),
    );
    const myFeedbackPending = interviews.filter(
      row =>
        (row.interviewerIds || []).includes(userId) &&
        !mySubmitted.has(row.id) &&
        !['CANCELLED', 'NO_SHOW'].includes(row.status),
    ).length;

    const myUpcomingInterviews = interviews.filter(row => {
      if (!(row.interviewerIds || []).includes(userId)) return false;
      if (!['SCHEDULED', 'RESCHEDULED'].includes(row.status)) return false;
      const when = new Date(row.scheduledAt || '').getTime();
      return !Number.isNaN(when) && when >= nowMs && when <= weekAheadMs;
    }).length;

    const myCompensation = compensation.filter(
      row => row.status === 'PENDING' && (row.pendingApproverIds || []).includes(userId),
    ).length;

    const offersToApprove = offers.filter(
      row =>
        row.status === 'PENDING_APPROVAL' &&
        ((row.pendingApproverIds || []).length === 0
          ? permissions.can('Approve', 'Offers')
          : (row.pendingApproverIds || []).includes(userId)),
    ).length;

    const offersToSend = offers.filter(row => row.status === 'APPROVED').length;

    const documentsByJoining = new Map<string, PreJoiningDocument[]>();
    for (const document of documents) {
      if (!document.joiningRecordId) continue;
      const bucket = documentsByJoining.get(document.joiningRecordId);
      if (bucket) bucket.push(document);
      else documentsByJoining.set(document.joiningRecordId, [document]);
    }

    const documentsPending = joinings.filter(row => {
      if (['JOINED', 'NOT_JOINED', 'OFFER_CANCELLED'].includes(row.status)) return false;
      const summary = summarizeDocumentChecklist(
        (documentsByJoining.get(row.id) || []).map(item => ({ status: item.status, mandatory: item.mandatory })),
      );
      return summary.mandatoryPending > 0;
    }).length;

    const joiningThisWeek = joinings.filter(row => {
      if (['JOINED', 'NOT_JOINED', 'OFFER_CANCELLED'].includes(row.status)) return false;
      const date = new Date(row.revisedJoiningDate || row.plannedJoiningDate || '');
      if (Number.isNaN(date.getTime())) return false;
      const days = Math.floor((date.getTime() - nowMs) / 86_400_000);
      return days >= 0 && days <= 7;
    }).length;

    const overSla = requirements.filter(row => {
      if (!isOpenRequirementStatus(row.status)) return false;
      const sla = evaluateRequirementSla({
        startedAt: row.slaStartedAt?.toDate?.() || null,
        targetDays: row.slaTargetDays || settings.sla.targets[row.priority] || settings.sla.targets.Normal,
        heldDays: row.slaHeldDays,
        pauseOnHold: settings.sla.pauseOnHold,
      });
      return sla.state === 'Overdue';
    }).length;

    const myRequirementsOverSla = requirements.filter(row => {
      if (row.primaryRecruiterId !== userId && row.secondaryRecruiterId !== userId) return false;
      if (!isOpenRequirementStatus(row.status)) return false;
      const sla = evaluateRequirementSla({
        startedAt: row.slaStartedAt?.toDate?.() || null,
        targetDays: row.slaTargetDays || settings.sla.targets[row.priority] || settings.sla.targets.Normal,
        heldDays: row.slaHeldDays,
        pauseOnHold: settings.sla.pauseOnHold,
      });
      return sla.state === 'Overdue' || sla.state === 'Due soon';
    }).length;

    const unassigned = requirements.filter(
      row => ['APPROVED', 'RECRUITER_ASSIGNMENT_PENDING'].includes(row.status) && !row.primaryRecruiterId,
    ).length;

    const myDrafts = requirements.filter(
      row => row.status === 'DRAFT' && row.requestingManagerId === userId,
    ).length;

    const sentBack = requirements.filter(
      row => row.status === 'REJECTED' && row.requestingManagerId === userId,
    ).length;

    return [
      { label: 'Requirements need your approval', count: myApprovals, href: '/hr/approvals', icon: ClipboardCheck, tone: 'amber' },
      { label: 'Interview feedback pending from you', count: myFeedbackPending, href: '/hr/interviews/my', icon: Star, tone: 'violet' },
      { label: 'Your interviews in the next 7 days', count: myUpcomingInterviews, href: '/hr/interviews/my', icon: CalendarCheck, tone: 'blue' },
      { label: 'Compensation approvals pending', count: myCompensation, href: '/hr/selection', icon: CircleDollarSign, tone: 'orange' },
      { label: 'Offers need approval', count: offersToApprove, href: '/hr/offers', icon: FileSignature, tone: 'indigo' },
      { label: 'Approved offers not yet sent', count: offersToSend, href: '/hr/offers', icon: FileSignature, tone: 'teal' },
      { label: 'Candidate documents pending', count: documentsPending, href: '/hr/pre-joining', icon: FileText, tone: 'rose' },
      { label: 'Candidates joining this week', count: joiningThisWeek, href: '/hr/joining', icon: UserPlus, tone: 'emerald' },
      {
        label: 'Your requirements at or past SLA',
        count: myRequirementsOverSla,
        href: '/hr/requirements',
        icon: Clock,
        tone: 'rose',
        hint: 'Assigned to you as recruiter',
      },
      { label: 'Requirements over SLA', count: overSla, href: '/hr/reports/sla', icon: Clock, tone: 'rose' },
      { label: 'Approved requirements without a recruiter', count: unassigned, href: '/hr/requirements', icon: UserPlus, tone: 'amber' },
      { label: 'Your drafts not yet submitted', count: myDrafts, href: '/hr/requirements', icon: FileText, tone: 'slate' },
      { label: 'Sent back to you for revision', count: sentBack, href: '/hr/requirements', icon: FileText, tone: 'orange' },
    ].filter(task => task.count > 0);
  }, [requirements, interviews, feedback, compensation, offers, joinings, documents, actor, settings, permissions]);

  if (loading || configLoading) return <HrLoader label="Working out what needs you…" />;

  const toneClasses: Record<string, string> = {
    amber: 'border-amber-200 bg-amber-50/70 text-amber-900',
    violet: 'border-violet-200 bg-violet-50/70 text-violet-900',
    blue: 'border-blue-200 bg-blue-50/70 text-blue-900',
    orange: 'border-orange-200 bg-orange-50/70 text-orange-900',
    indigo: 'border-indigo-200 bg-indigo-50/70 text-indigo-900',
    teal: 'border-teal-200 bg-teal-50/70 text-teal-900',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-900',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
    slate: 'border-slate-200 bg-slate-50/70 text-slate-900',
  };

  return (
    <div>
      <HrPageHeader
        title="My HR Tasks"
        description={
          tasks.length === 0
            ? 'Nothing needs you right now.'
            : `${tasks.reduce((sum, task) => sum + task.count, 0)} items across ${tasks.length} ${tasks.length === 1 ? 'queue' : 'queues'}`
        }
      />

      {tasks.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="font-medium text-emerald-900">You are up to date</p>
            <p className="max-w-md text-sm text-emerald-800">
              No approvals, interview feedback, offers or joinings are waiting on you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map(task => {
            const Icon = task.icon;
            return (
              <Link
                key={task.label}
                href={task.href}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 transition-shadow hover:shadow-md',
                  toneClasses[task.tone] || toneClasses.slate,
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-semibold tabular-nums">{task.count}</span>
                    {task.hint && (
                      <Badge variant="outline" className="border-current/20 bg-white/60 text-[10px]">
                        {task.hint}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-medium">{task.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
