'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, ExternalLink, FileText, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  HR_COLLECTIONS,
  type Candidate,
  type CandidateApplication,
  type HrOffer,
  type Interview,
  type InterviewFeedback,
  type JoiningRecord,
} from '@/lib/hr-requirement';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrLoader,
  HrPageHeader,
  HrSection,
  HrStatusBadge,
  SensitiveMoney,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * One candidate, and every requirement they have ever been considered for (spec sections 19, 21).
 *
 * This is the screen that makes a single candidate master worth having: a recruiter about to add
 * someone to a pipeline can see that they were interviewed for a similar role eight months ago and
 * why it did not proceed — which is exactly the information that gets lost when a candidate is
 * re-created per requisition.
 *
 * Interview feedback is shown as scores and the panel's recommendation, never as the interviewers'
 * written comments: those belong to the panel and the selection committee (spec section 26).
 */

export default function CandidateDetail({ candidateId }: { candidateId: string }) {
  const { loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: candidates, loading } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: interviews } = useHrCollection<Interview>(HR_COLLECTIONS.interviews);
  const { rows: feedback } = useHrCollection<InterviewFeedback>(HR_COLLECTIONS.interviewFeedback);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);

  const candidate = candidates.find(row => row.id === candidateId) || null;

  const scoped = useMemo(
    () => ({
      applications: applications
        .filter(row => row.candidateId === candidateId)
        .sort((a, b) => (b.appliedAt?.toMillis?.() || 0) - (a.appliedAt?.toMillis?.() || 0)),
      interviews: interviews
        .filter(row => row.candidateId === candidateId)
        .sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || '')),
      offers: offers.filter(row => row.candidateId === candidateId),
      joinings: joinings.filter(row => row.candidateId === candidateId),
    }),
    [applications, interviews, offers, joinings, candidateId],
  );

  const feedbackCount = useMemo(
    () => feedback.filter(row => row.candidateId === candidateId && row.submitted).length,
    [feedback, candidateId],
  );

  if (loading || configLoading) return <HrLoader label="Loading candidate…" />;

  if (!candidate) {
    return (
      <HrEmptyState
        icon={AlertTriangle}
        title="Candidate not found"
        description="The profile may have been removed, or belong to another organisation."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/hr/candidates">Back to the candidate database</Link>
          </Button>
        }
      />
    );
  }

  const joined = scoped.joinings.find(row => row.status === 'JOINED');

  return (
    <div>
      <HrPageHeader
        title={candidate.name}
        description={`${candidate.candidateNumber} · ${candidate.source}${
          candidate.sourceDetail ? ` (${candidate.sourceDetail})` : ''
        }`}
        actions={
          <>
            {candidate.resumeUrl && (
              <Button asChild variant="outline" className="gap-2">
                <a href={candidate.resumeUrl} target="_blank" rel="noreferrer">
                  <FileText className="h-4 w-4" /> Resume
                </a>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/hr/candidates">Back</Link>
            </Button>
          </>
        }
      />

      {candidate.doNotHire && (
        <div className="mb-3">
          <HrAlertNotice tone="rose" title="Do not hire">
            {candidate.doNotHireReason || 'No reason recorded.'} New applications for this candidate are blocked
            until the flag is cleared.
          </HrAlertNotice>
        </div>
      )}

      {joined && (
        <div className="mb-3">
          <HrAlertNotice tone="emerald" title="Now an employee">
            Joined as {joined.designation} on {joined.actualJoiningDate}
            {joined.employeeCode ? ` with employee code ${joined.employeeCode}` : ''}.
          </HrAlertNotice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm lg:col-span-2">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <HrField label="Mobile">{candidate.mobile || '—'}</HrField>
              <HrField label="Alternate mobile">{candidate.alternateMobile || '—'}</HrField>
              <HrField label="Email">{candidate.email || '—'}</HrField>
              <HrField label="Date of birth">{candidate.dateOfBirth || '—'}</HrField>
              <HrField label="Current company">{candidate.currentCompany || '—'}</HrField>
              <HrField label="Current designation">{candidate.currentDesignation || '—'}</HrField>
              <HrField label="Location">{candidate.currentLocation || '—'}</HrField>
              <HrField label="Total experience">
                {candidate.totalExperienceYears ? `${candidate.totalExperienceYears} years` : '—'}
              </HrField>
              <HrField label="Relevant experience">
                {candidate.relevantExperienceYears ? `${candidate.relevantExperienceYears} years` : '—'}
              </HrField>
              <HrField label="Current CTC">
                <SensitiveMoney value={candidate.currentCtc} canView={permissions.canViewSalary} />
              </HrField>
              <HrField label="Expected CTC">
                <SensitiveMoney value={candidate.expectedCtc} canView={permissions.canViewSalary} />
              </HrField>
              <HrField label="Notice period">
                {candidate.noticePeriodDays ? `${candidate.noticePeriodDays} days` : '—'}
              </HrField>
              <HrField label="Qualification">{candidate.qualification || '—'}</HrField>
              <HrField label="Specialisation">{candidate.specialization || '—'}</HrField>
              <HrField label="Recruiter">{candidate.ownerRecruiterName || '—'}</HrField>
            </div>

            {candidate.skills?.length ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {candidate.skills.map(skill => (
                    <Badge key={skill} variant="secondary" className="text-[10px]">{skill}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Applications</span>
                <span className="text-sm font-semibold tabular-nums">{scoped.applications.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Interviews</span>
                <span className="text-sm font-semibold tabular-nums">{scoped.interviews.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Feedback received</span>
                <span className="text-sm font-semibold tabular-nums">{feedbackCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Offers</span>
                <span className="text-sm font-semibold tabular-nums">{scoped.offers.length}</span>
              </div>
              {candidate.lastRejectionReason && (
                <div className="border-t border-slate-100 pt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last rejection</p>
                  <p className="text-sm text-slate-700">{candidate.lastRejectionReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {candidate.inTalentPool && (
            <Card className="border-cyan-200 bg-cyan-50/60 shadow-sm">
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-cyan-900">
                  <Sparkles className="h-4 w-4" /> In the talent pool
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(candidate.talentPoolCategories || []).map(category => (
                    <Badge key={category} variant="outline" className="border-cyan-300 bg-white text-[10px] text-cyan-800">
                      {category}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {candidate.isInternal && (
            <Card className="border-blue-200 bg-blue-50/60 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-blue-900">Internal candidate</p>
                <p className="mt-0.5 text-xs text-blue-800">
                  Applying through an internal job posting — the transfer route of spec section 45 applies.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Application history — the reason a single candidate master matters (spec section 21). */}
      <div className="mt-4 space-y-4">
        <HrSection title="Application history" description="Every requirement this candidate has been considered for.">
          <HrDataList
            rows={scoped.applications}
            columns={[
              {
                header: 'Requirement',
                mobile: 'title',
                cell: row => (
                  <Link href={`/hr/requirements/${row.requirementId}`} className="font-medium text-indigo-700 hover:underline">
                    {row.requirementNumber}
                  </Link>
                ),
              },
              { header: 'Designation', mobile: 'title', cell: row => row.designation || '—' },
              { header: 'Applied', cell: row => row.appliedAt?.toDate?.().toLocaleDateString('en-IN') || '—' },
              { header: 'Source', className: 'hidden lg:table-cell', cell: row => row.source },
              {
                header: 'Interview',
                align: 'right',
                cell: row => (row.latestInterviewScore ? `${row.latestInterviewScore}/5` : '—'),
              },
              { header: 'Panel', className: 'hidden xl:table-cell', cell: row => row.panelRecommendation || '—' },
              { header: 'Stage', mobile: 'aside', cell: row => <HrStatusBadge status={row.stage} /> },
              {
                header: 'Outcome',
                className: 'hidden lg:table-cell',
                cell: row => row.exitReason || (row.stage === 'JOINED' ? 'Joined' : '—'),
              },
            ]}
            empty={<HrEmptyState icon={ExternalLink} title="No applications yet" description="This candidate has not been put forward for a requirement." />}
          />
        </HrSection>

        <HrSection title="Interview history" description="Scores and the panel's view; written feedback stays with the panel.">
          <HrDataList
            rows={scoped.interviews}
            columns={[
              { header: 'Round', mobile: 'title', cell: row => row.round },
              {
                header: 'Requirement',
                mobile: 'title',
                cell: row => (
                  <Link href={`/hr/requirements/${row.requirementId}`} className="text-xs text-muted-foreground hover:underline">
                    {row.requirementNumber}
                  </Link>
                ),
              },
              {
                header: 'When',
                cell: row =>
                  row.scheduledAt ? new Date(row.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—',
              },
              { header: 'Mode', className: 'hidden lg:table-cell', cell: row => row.mode },
              {
                header: 'Score',
                align: 'right',
                cell: row =>
                  row.averageScore ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Star className="h-3 w-3 text-amber-500" />
                      {row.averageScore}/5
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                header: 'Panel view',
                cell: row => (
                  <span className="inline-flex items-center gap-1.5">
                    {row.panelRecommendation || '—'}
                    {row.hasDissent && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">dissent</Badge>
                    )}
                  </span>
                ),
              },
              { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
            ]}
            empty={<HrEmptyState icon={Star} title="No interviews yet" />}
          />
        </HrSection>

        {scoped.offers.length > 0 && (
          <HrSection title="Offers">
            <HrDataList
              rows={scoped.offers}
              columns={[
                { header: 'Offer', mobile: 'title', cell: row => row.offerNumber },
                { header: 'Designation', mobile: 'title', cell: row => row.designation },
                {
                  header: 'CTC',
                  align: 'right',
                  cell: row => <SensitiveMoney value={row.offeredCtc} canView={permissions.canViewSalary} />,
                },
                { header: 'Joining', cell: row => row.joiningDate || '—' },
                { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
                {
                  header: 'Outcome',
                  className: 'hidden lg:table-cell',
                  cell: row => row.rejectionReason || row.withdrawalReason || '—',
                },
              ]}
            />
          </HrSection>
        )}
      </div>
    </div>
  );
}
