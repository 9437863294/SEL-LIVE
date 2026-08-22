'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Ban,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileSignature,
  FileText,
  FolderKanban,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  RECRUITMENT_COST_HEADS,
  REQUIREMENT_HOLD_REASONS,
  dayDifference,
  evaluateRequirementClosure,
  evaluateRequirementSla,
  hrCurrency,
  hrStatusLabel,
  isRecruitingStatus,
  isTerminalRequirementStatus,
  matchTalentPool,
  summarizeRecruitmentCost,
  summarizeRequirementFill,
  type Candidate,
  type CandidateApplication,
  type HrActivity,
  type HrOffer,
  type HrRequirement,
  type HrRequirementApproval,
  type JoiningRecord,
  type RecruitmentCost,
  type RecruitmentCostHead,
  type RequirementHoldReason,
  type TalentPoolEntry,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  assignRecruiter,
  cancelRequirement,
  closeRequirement,
  createApplication,
  holdRequirement,
  logHrActivity,
  recordRecruitmentCost,
  resumeRequirement,
  submitRequirement,
  updateRequirement,
} from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrFillBar,
  HrKpiCard,
  HrLoader,
  HrPriorityBadge,
  HrSection,
  HrSlaBadge,
  HrStatusBadge,
  Money,
  SensitiveMoney,
  hrDialog,
} from './hr-ui';
import InterviewPanel, { ReasonDialog } from './interview-panel';
import JoiningPanel from './joining-panel';
import OfferPanel from './offer-panel';
import PipelineBoard from './pipeline-board';
import SelectionPanel from './selection-panel';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The Requirement Workspace of spec section 16 — the control centre for one requirement.
 *
 * Every tab here reuses the standalone screen for the same thing, scoped by `requirementId`, rather
 * than reimplementing it: the Pipeline tab *is* the pipeline board, the Offers tab *is* the offer
 * panel. That is the only way the gates on stage moves and offer release can be guaranteed to behave
 * identically whether a recruiter works from the workspace or from the module's own screens.
 *
 * The header is deliberately dense. A recruiter opening a requisition needs to know, without
 * scrolling, how many seats remain, how old it is against its SLA, and who owns it — which is the
 * information the spec puts in its own header sketch.
 */

export default function RequirementWorkspace({ requirementId }: { requirementId: string }) {
  const { toast } = useToast();
  const { settings, users, actor, departments, projects, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();

  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);
  const { rows: approvals } = useHrCollection<HrRequirementApproval>(HR_COLLECTIONS.requirementApprovals);
  const { rows: activities } = useHrCollection<HrActivity>(HR_COLLECTIONS.activities);
  const { rows: costs } = useHrCollection<RecruitmentCost>(HR_COLLECTIONS.costs);
  const { rows: talentPool } = useHrCollection<TalentPoolEntry>(HR_COLLECTIONS.talentPool);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);

  const [assignOpen, setAssignOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');

  const requirement = requirements.find(row => row.id === requirementId) || null;

  /**
   * The notes editor holds a draft only once the user has typed something; until then it shows what
   * is saved. Derived rather than synced from an effect — copying the saved value into state on every
   * snapshot would either fight the user's typing or need an effect that sets state during render.
   */
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const notes = notesDraft ?? requirement?.notes ?? '';
  const setNotes = (value: string) => setNotesDraft(value);

  const scoped = useMemo(
    () => ({
      applications: applications.filter(row => row.requirementId === requirementId),
      offers: offers.filter(row => row.requirementId === requirementId),
      joinings: joinings.filter(row => row.requirementId === requirementId),
      approvals: approvals
        .filter(row => row.requirementId === requirementId)
        .sort((a, b) => (a.actedAt?.toMillis?.() || 0) - (b.actedAt?.toMillis?.() || 0)),
      activities: activities
        .filter(row => row.requirementId === requirementId)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
      costs: costs.filter(row => row.requirementId === requirementId),
    }),
    [applications, offers, joinings, approvals, activities, costs, requirementId],
  );

  const fill = useMemo(
    () =>
      requirement
        ? summarizeRequirementFill({
            requestedQuantity: requirement.requestedQuantity,
            joinedCount: scoped.joinings.filter(row => row.status === 'JOINED').length,
            offerAcceptedCount: scoped.offers.filter(row => row.status === 'ACCEPTED').length,
            offeredCount: scoped.offers.filter(row => ['SENT', 'VIEWED'].includes(row.status)).length,
            inPipelineCount: requirement.applicationCount,
            cancelledPositions: requirement.cancelledPositions,
          })
        : null,
    [requirement, scoped],
  );

  const sla = useMemo(
    () =>
      requirement
        ? evaluateRequirementSla({
            startedAt: requirement.slaStartedAt?.toDate?.() || null,
            targetDays: requirement.slaTargetDays || settings.sla.targets[requirement.priority] || settings.sla.targets.Normal,
            heldDays: requirement.slaHeldDays,
            pauseOnHold: settings.sla.pauseOnHold,
          })
        : null,
    [requirement, settings],
  );

  const costSummary = useMemo(
    () => summarizeRecruitmentCost(scoped.costs, fill?.joined || 0),
    [scoped.costs, fill],
  );

  /** Talent-pool suggestions (spec section 48). */
  const suggestions = useMemo(() => {
    if (!requirement) return [];
    const alreadyApplied = new Set(scoped.applications.map(row => row.candidateId));
    const pool = talentPool
      .filter(entry => entry.active !== false && !alreadyApplied.has(entry.candidateId))
      .map(entry => ({
        ...entry,
        designation: entry.designation,
        skills: entry.skills,
        totalExperienceYears: entry.totalExperienceYears,
        locationId: entry.locationId,
        location: entry.location,
      }));
    return matchTalentPool(
      {
        designation: requirement.designation,
        mandatorySkills: requirement.skills?.mandatorySkills?.length ? requirement.skills.mandatorySkills : requirement.skills?.primarySkills,
        preferredSkills: requirement.skills?.preferredSkills,
        minExperienceYears: requirement.minExperienceYears,
        maxExperienceYears: requirement.maxExperienceYears,
        locationId: requirement.locationId,
        location: requirement.location,
      },
      pool,
      { limit: 8 },
    );
  }, [requirement, talentPool, scoped.applications]);

  const closure = useMemo(
    () =>
      requirement
        ? evaluateRequirementClosure({
            status: requirement.status,
            requestedQuantity: requirement.requestedQuantity,
            joinedCount: scoped.joinings.filter(row => row.status === 'JOINED').length,
            liveOfferCount: scoped.offers.filter(row => ['SENT', 'VIEWED'].includes(row.status)).length,
            upcomingJoiningCount: scoped.joinings.filter(row =>
              ['CONFIRMED', 'CONFIRMATION_PENDING', 'DOCUMENTS_PENDING'].includes(row.status),
            ).length,
            activeCandidateCount: scoped.applications.filter(row =>
              !['JOINED', 'REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'OFFER_REJECTED', 'NO_SHOW', 'TALENT_POOL'].includes(row.stage),
            ).length,
          })
        : null,
    [requirement, scoped],
  );

  if (loading || configLoading) return <HrLoader label="Loading requirement…" />;

  if (!requirement || !fill || !sla || !closure) {
    return (
      <HrEmptyState
        icon={AlertTriangle}
        title="Requirement not found"
        description="It may have been deleted, or belong to another organisation."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/hr/requirements">Back to the register</Link>
          </Button>
        }
      />
    );
  }

  const ageDays = requirement.createdAt?.toDate?.()
    ? Math.max(0, dayDifference(requirement.createdAt.toDate(), new Date()))
    : 0;

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await work();
      toast({ title: success });
    } catch (error) {
      toast({
        title: 'Action failed',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const addFromTalentPool = async (candidateId: string, candidateName: string) => {
    if (!actor) return;
    await run(
      () => createApplication({ requirementId, candidateId, source: 'Talent Pool' }, actor),
      `${candidateName} added to the pipeline`,
    );
  };

  const saveNotes = async () => {
    if (!actor) return;
    await run(() => updateRequirement(requirementId, { notes } as never, actor), 'Notes saved');
  };

  const postComment = async () => {
    if (!actor || !comment.trim()) return;
    await run(
      () =>
        logHrActivity({
          actor,
          entityType: 'requirement',
          entityId: requirementId,
          requirementId,
          action: 'Comment',
          summary: comment.trim(),
        }),
      'Comment posted',
    );
    setComment('');
  };

  const canAct = !isTerminalRequirementStatus(requirement.status);

  return (
    <div>
      {/* ── Header (spec section 16) ── */}
      <Card className="mb-4 border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-slate-800">{requirement.requirementNumber}</h1>
                <HrStatusBadge status={requirement.status} />
                <HrPriorityBadge priority={requirement.priority} />
                {requirement.fastTrack && (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Fast track</Badge>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-700">
                {requirement.requestedQuantity} × {requirement.designation}
                {requirement.grade ? ` · ${requirement.grade}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {requirement.departmentName}
                {requirement.projectName ? ` · ${requirement.projectName}` : ''}
                {requirement.location ? ` · ${requirement.location}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Raised {requirement.requirementDate}</span>
                <span>Age {ageDays}d</span>
                {requirement.targetClosureDate && <span>Target {requirement.targetClosureDate}</span>}
                <span>
                  Recruiter{' '}
                  {requirement.primaryRecruiterName || <span className="font-medium text-amber-700">unassigned</span>}
                </span>
                <HrSlaBadge state={sla.state} consumedPercent={sla.consumedPercent} overdueDays={sla.overdueDays} />
              </div>
            </div>

            {/* Actions, in the order a requirement actually moves. */}
            <div className="flex shrink-0 flex-wrap gap-2">
              {['DRAFT', 'REJECTED'].includes(requirement.status) && (
                <>
                  {permissions.can('Edit', 'Requirements') && (
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                      <Link href={`/hr/requirements/${requirementId}/edit`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Link>
                    </Button>
                  )}
                  {permissions.can('Submit', 'Requirements') && (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            submitRequirement(requirementId, actor!, {
                              departmentHodId: requirement.departmentHodId,
                              projectHeadId: requirement.projectHeadId,
                              requestingManagerId: requirement.requestingManagerId,
                              roleByUserId: Object.fromEntries(users.map(row => [row.id, row.role || ''])),
                            }),
                          'Submitted for approval',
                        )
                      }
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
                    </Button>
                  )}
                </>
              )}

              {['APPROVED', 'RECRUITER_ASSIGNMENT_PENDING'].includes(requirement.status) &&
                permissions.can('Assign Recruiter', 'Requirements') && (
                  <Button size="sm" className="gap-1.5" onClick={() => setAssignOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5" /> Assign recruiter
                  </Button>
                )}

              {isRecruitingStatus(requirement.status) && permissions.can('Assign Recruiter', 'Requirements') && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAssignOpen(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> Reassign
                </Button>
              )}

              {isRecruitingStatus(requirement.status) && permissions.can('Hold', 'Requirements') && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setHoldOpen(true)}>
                  <Pause className="h-3.5 w-3.5" /> Hold
                </Button>
              )}

              {requirement.status === 'ON_HOLD' && permissions.can('Resume', 'Requirements') && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => run(() => resumeRequirement(requirementId, actor!), 'Requirement resumed')}
                >
                  <Play className="h-3.5 w-3.5" /> Resume
                </Button>
              )}

              {canAct && permissions.can('Close', 'Requirements') && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCloseOpen(true)}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Close
                </Button>
              )}

              {canAct && permissions.can('Cancel', 'Requirements') && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-rose-700" onClick={() => setCancelOpen(true)}>
                  <Ban className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Fill counters — the spec's own header figures. */}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <HrKpiCard label="Required" value={fill.effectiveRequired} tone="blue" />
            <HrKpiCard label="Joined" value={fill.joined} tone="emerald" />
            <HrKpiCard label="Offer accepted" value={fill.offerAccepted} tone="violet" />
            <HrKpiCard label="Offered" value={fill.offered} tone="orange" />
            <HrKpiCard label="In pipeline" value={scoped.applications.filter(row => !['JOINED', 'REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'OFFER_REJECTED', 'NO_SHOW', 'TALENT_POOL'].includes(row.stage)).length} tone="indigo" />
            <HrKpiCard label="Balance" value={fill.balance} tone={fill.balance > 0 ? 'rose' : 'teal'} />
          </div>
          <div className="mt-3">
            <HrFillBar required={fill.effectiveRequired} joined={fill.joined} accepted={fill.offerAccepted} />
          </div>

          {requirement.status === 'ON_HOLD' && (
            <div className="mt-3">
              <HrAlertNotice tone="amber" title="On hold">
                {requirement.holdReason}
                {requirement.holdRemarks ? ` — ${requirement.holdRemarks}` : ''}
                {settings.sla.pauseOnHold ? ' The SLA clock is paused.' : ' The SLA clock keeps running.'}
              </HrAlertNotice>
            </div>
          )}

          {requirement.status === 'REJECTED' && requirement.rejectionReason && (
            <div className="mt-3">
              <HrAlertNotice tone="rose" title="Returned">
                {requirement.rejectionReason}
              </HrAlertNotice>
            </div>
          )}

          {fill.recommendClosure && canAct && (
            <div className="mt-3">
              <HrAlertNotice tone="emerald" title="Requirement fulfilled">
                All {fill.effectiveRequired} positions have joined. Close this requirement?
                {permissions.can('Close', 'Requirements') && (
                  <Button size="sm" variant="outline" className="ml-2 h-6 bg-white" onClick={() => setCloseOpen(true)}>
                    Close now
                  </Button>
                )}
              </HrAlertNotice>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Tabs (spec section 16) ── */}
      <Tabs defaultValue="overview">
        <TabsList className="mb-3 w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="jd">Job description</TabsTrigger>
          <TabsTrigger value="candidates">
            Candidates
            {scoped.applications.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 tabular-nums">{scoped.applications.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="selection">Selection</TabsTrigger>
          <TabsTrigger value="offers">
            Offers
            {scoped.offers.length > 0 && <Badge variant="secondary" className="ml-1.5 tabular-nums">{scoped.offers.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="joining">Joining</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="communication">Communication</TabsTrigger>
          <TabsTrigger value="approvals">
            Approvals
            {scoped.approvals.length > 0 && <Badge variant="secondary" className="ml-1.5 tabular-nums">{scoped.approvals.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HrSection title="Requirement" description="Spec sections 5 to 7.">
              <div className="grid grid-cols-2 gap-3">
                <HrField label="Type">{requirement.requirementType}</HrField>
                <HrField label="Reason">{requirement.requirementReason || '—'}</HrField>
                <HrField label="Employment type">{requirement.employmentType}</HrField>
                <HrField label="Grade">{requirement.grade}</HrField>
                <HrField label="Job title">{requirement.jobTitle}</HrField>
                <HrField label="Reporting to">{requirement.reportingToName || '—'}</HrField>
                <HrField label="Required joining">{requirement.requiredJoiningDate}</HrField>
                <HrField label="Experience">
                  {requirement.minExperienceYears}
                  {requirement.maxExperienceYears ? `–${requirement.maxExperienceYears}` : '+'} years
                </HrField>
                <HrField label="Qualification">{requirement.qualification}</HrField>
                <HrField label="Specialisation">{requirement.specialization || '—'}</HrField>
                <HrField label="Shift">{requirement.shift || '—'}</HrField>
                <HrField label="Travel">{requirement.travelRequirement || '—'}</HrField>
                <HrField label="Requested by">{requirement.requestingManagerName}</HrField>
                <HrField label="Requirement owner">{requirement.requirementOwnerName || '—'}</HrField>
              </div>

              {requirement.replacement && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Replacement of</p>
                  <div className="grid grid-cols-2 gap-3">
                    <HrField label="Employee">
                      {requirement.replacement.employeeName}
                      {requirement.replacement.employeeCode ? ` (${requirement.replacement.employeeCode})` : ''}
                    </HrField>
                    <HrField label="Designation">{requirement.replacement.designation || '—'}</HrField>
                    <HrField label="Reason">{requirement.replacement.reason}</HrField>
                    <HrField label="Last working date">{requirement.replacement.lastWorkingDate || '—'}</HrField>
                    <HrField label="Current CTC">
                      <SensitiveMoney value={requirement.replacement.currentCtc} canView={permissions.canViewSalary} />
                    </HrField>
                  </div>
                </div>
              )}
            </HrSection>

            <div className="space-y-4">
              <HrSection title="Budget" description="Spec section 9.">
                <div className="grid grid-cols-2 gap-3">
                  <HrField label="Expected CTC">
                    <SensitiveMoney value={requirement.budget?.expectedCtc} canView={permissions.canViewSalary} />
                  </HrField>
                  <HrField label="Approved band">
                    {permissions.canViewSalary && requirement.budget?.bandMax
                      ? `${hrCurrency(requirement.budget.bandMin)} – ${hrCurrency(requirement.budget.bandMax)}`
                      : '₹ ••••'}
                  </HrField>
                  <HrField label="Annual manpower cost">
                    <SensitiveMoney
                      value={(requirement.budget?.expectedCtc || 0) * requirement.requestedQuantity}
                      canView={permissions.canViewSalary}
                    />
                  </HrField>
                  <HrField label="Cost centre">{requirement.budget?.costCentre || '—'}</HrField>
                  <HrField label="Budget available">{requirement.budget?.budgetAvailable === false ? 'No' : 'Yes'}</HrField>
                  <HrField label="Variance">
                    {requirement.budget?.ctcAboveBand ? `+${requirement.budget.ctcVariancePercent}% above band` : 'Within band'}
                  </HrField>
                </div>
              </HrSection>

              <HrSection title="Skills" description="Spec section 8.">
                <div className="space-y-2">
                  {([
                    ['Primary', requirement.skills?.primarySkills],
                    ['Mandatory', requirement.skills?.mandatorySkills],
                    ['Preferred', requirement.skills?.preferredSkills],
                    ['Secondary', requirement.skills?.secondarySkills],
                  ] as const).map(([label, list]) =>
                    list?.length ? (
                      <div key={label}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {list.map(skill => (
                            <Badge key={skill} variant="secondary" className="text-[10px]">{skill}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                  {requirement.skills?.domain && <HrField label="Domain">{requirement.skills.domain}</HrField>}
                  {requirement.skills?.projectExperience && (
                    <HrField label="Project experience">{requirement.skills.projectExperience}</HrField>
                  )}
                </div>
              </HrSection>
            </div>
          </div>

          {requirement.justification && Object.values(requirement.justification).some(Boolean) && (
            <HrSection title="Justification" description="Spec section 10.">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <HrField label="Business justification">{requirement.justification.businessJustification || '—'}</HrField>
                <HrField label="Current workload">{requirement.justification.currentWorkload || '—'}</HrField>
                <HrField label="Project requirement">{requirement.justification.projectRequirement || '—'}</HrField>
                <HrField label="Client requirement">{requirement.justification.clientRequirement || '—'}</HrField>
                <HrField label="Why existing manpower cannot absorb it">
                  {requirement.justification.whyExistingManpowerInsufficient || '—'}
                </HrField>
                <HrField label="Impact if vacant">{requirement.justification.impactIfVacant || '—'}</HrField>
              </div>
            </HrSection>
          )}

          {/* Talent-pool suggestions (spec section 48). */}
          {suggestions.length > 0 && isRecruitingStatus(requirement.status) && (
            <HrSection
              title="Talent pool matches"
              description={`${suggestions.length} previously shortlisted ${suggestions.length === 1 ? 'candidate matches' : 'candidates match'} this requirement.`}
            >
              <div className="space-y-2">
                {suggestions.map(match => (
                  <div key={match.candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{match.candidate.candidateName}</p>
                        <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-[10px] text-cyan-700">
                          {match.score}% match
                        </Badge>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {match.reasons.join(' · ') || 'Matched on the talent pool category'}
                      </p>
                    </div>
                    {permissions.can('Add Candidate', 'Pipeline') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() => addFromTalentPool(match.candidate.candidateId, match.candidate.candidateName)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </HrSection>
          )}

          {requirement.originalRequirementId && (
            <HrAlertNotice tone="blue" title="Linked requirement">
              This requirement replaces{' '}
              <Link href={`/hr/requirements/${requirement.originalRequirementId}`} className="font-semibold underline">
                an earlier requisition
              </Link>
              , so the manpower history of the position stays traceable.
            </HrAlertNotice>
          )}
        </TabsContent>

        {/* Job description */}
        <TabsContent value="jd">
          <JobDescriptionTab requirement={requirement} />
        </TabsContent>

        {/* Candidates — the list view of the same applications the board shows. */}
        <TabsContent value="candidates">
          <HrSection title="Candidates" description={`${scoped.applications.length} applications against this requirement.`}>
            <HrDataList
              rows={scoped.applications}
              columns={[
                {
                  header: 'Candidate',
                  mobile: 'title',
                  cell: row => (
                    <Link href={`/hr/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                      {row.candidateName}
                    </Link>
                  ),
                },
                { header: 'Mobile', className: 'hidden lg:table-cell', cell: row => row.candidateMobile || '—' },
                { header: 'Source', cell: row => row.source },
                { header: 'Recruiter', className: 'hidden xl:table-cell', cell: row => row.recruiterName || '—' },
                {
                  header: 'Interview',
                  align: 'right',
                  cell: row => (row.latestInterviewScore ? `${row.latestInterviewScore}/5` : '—'),
                },
                { header: 'Stage', mobile: 'aside', cell: row => <HrStatusBadge status={row.stage} /> },
              ]}
              cardHref={row => `/hr/candidates/${row.candidateId}`}
              empty={
                <HrEmptyState
                  icon={Users}
                  title="No candidates yet"
                  description="Add candidates from the database, or from the talent-pool matches on the Overview tab."
                />
              }
            />
          </HrSection>
        </TabsContent>

        <TabsContent value="pipeline">
          <PipelineBoard requirementId={requirementId} embedded />
        </TabsContent>

        <TabsContent value="interviews">
          <InterviewPanel requirementId={requirementId} embedded />
        </TabsContent>

        <TabsContent value="selection">
          <SelectionPanel requirementId={requirementId} embedded />
        </TabsContent>

        <TabsContent value="offers">
          <OfferPanel requirementId={requirementId} embedded />
        </TabsContent>

        <TabsContent value="joining">
          <JoiningPanel requirementId={requirementId} embedded />
        </TabsContent>

        {/* Documents — the requirement's own attachments (spec section 10). */}
        <TabsContent value="documents">
          <HrSection
            title="Documents"
            description="Client contract, BOQ, organisation chart, approval note, resignation letter."
          >
            {requirement.attachments?.length ? (
              <div className="space-y-2">
                {requirement.attachments.map(attachment => (
                  <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{attachment.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {attachment.kind || 'Document'}
                        {attachment.uploadedByName ? ` · ${attachment.uploadedByName}` : ''}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a href={attachment.url} target="_blank" rel="noreferrer">Open</a>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <HrEmptyState icon={FileText} title="No documents attached" description="Attach the supporting papers for this requisition." />
            )}
          </HrSection>
        </TabsContent>

        {/* Communication — a comment thread on the requirement. */}
        <TabsContent value="communication">
          <HrSection title="Communication" description="Notes exchanged between the requester, HR and approvers.">
            <div className="mb-3 flex gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={event => setComment(event.target.value)}
                placeholder="Add a comment for everyone working this requirement…"
              />
              <Button onClick={postComment} disabled={busy || !comment.trim()} className="shrink-0 gap-1.5 self-end">
                <MessageSquare className="h-4 w-4" /> Post
              </Button>
            </div>
            <div className="space-y-2">
              {scoped.activities.filter(row => row.action === 'Comment').map(row => (
                <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-sm text-slate-800">{row.summary}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {row.userName} · {row.createdAt?.toDate?.().toLocaleString('en-IN') || 'just now'}
                  </p>
                </div>
              ))}
              {scoped.activities.filter(row => row.action === 'Comment').length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No comments yet.</p>
              )}
            </div>
          </HrSection>
        </TabsContent>

        {/* Approvals (spec sections 14, 57) */}
        <TabsContent value="approvals">
          <HrSection title="Approval trail" description="Spec section 14 — every decision, with its remarks.">
            {requirement.approvalStages?.length ? (
              <div className="mb-4 space-y-1.5">
                {requirement.approvalStages.map((stage, index) => {
                  const decision = scoped.approvals.find(row => row.stageIndex === index);
                  const current = (requirement.approvalStageIndex ?? -1) === index && !isTerminalRequirementStatus(requirement.status);
                  return (
                    <div
                      key={`${stage.key}-${index}`}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                        decision?.action === 'Approve' || decision?.action === 'Approve With Condition'
                          ? 'border-emerald-200 bg-emerald-50/60'
                          : decision?.action === 'Reject'
                            ? 'border-rose-200 bg-rose-50/60'
                            : current
                              ? 'border-amber-200 bg-amber-50/60'
                              : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {stage.label || stage.key.replace(/_/g, ' ')}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {decision
                            ? `${decision.action} by ${decision.approverName}${
                                decision.actedAt?.toDate?.() ? ` · ${decision.actedAt.toDate().toLocaleString('en-IN')}` : ''
                              }`
                            : current
                              ? `Awaiting ${(requirement.pendingApproverIds || [])
                                  .map(id => users.find(row => row.id === id)?.name || 'approver')
                                  .join(', ')}`
                              : 'Pending'}
                        </p>
                        {decision?.remarks && <p className="mt-0.5 text-[11px] text-slate-600">“{decision.remarks}”</p>}
                        {decision?.condition && (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-700">Condition: {decision.condition}</p>
                        )}
                      </div>
                      {current && <Clock className="h-4 w-4 shrink-0 text-amber-600" />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No approval chain yet — it is resolved when the requirement is submitted.
              </p>
            )}

            {requirement.approvalRuleName && (
              <p className="text-xs text-muted-foreground">
                Routed by <span className="font-medium text-slate-700">{requirement.approvalRuleName}</span>.
              </p>
            )}
          </HrSection>
        </TabsContent>

        {/* Activity log (spec section 57) */}
        <TabsContent value="activity">
          <HrSection title="Activity log" description="Spec section 57 — not deletable by normal users.">
            <div className="space-y-1.5">
              {scoped.activities.map(row => (
                <div key={row.id} className="flex gap-2.5 rounded-lg border border-slate-100 bg-white px-2.5 py-2">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{row.summary}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.action} · {row.userName} ·{' '}
                      {row.createdAt?.toDate?.().toLocaleString('en-IN') || '—'}
                    </p>
                    {row.remarks && <p className="mt-0.5 text-[11px] text-slate-600">“{row.remarks}”</p>}
                  </div>
                </div>
              ))}
              {scoped.activities.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
              )}
            </div>
          </HrSection>
        </TabsContent>

        {/* Cost (spec section 52) */}
        <TabsContent value="cost">
          <HrSection
            title="Recruitment cost"
            description="Spec section 52."
            actions={
              permissions.can('Add', 'Recruitment Cost') && (
                <Button size="sm" className="gap-1.5" onClick={() => setCostOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add cost
                </Button>
              )
            }
          >
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <HrKpiCard label="Total hiring cost" value={<Money value={costSummary.total} />} icon={CircleDollarSign} tone="orange" />
              <HrKpiCard label="Positions joined" value={costSummary.joined} icon={BadgeCheck} tone="emerald" />
              <HrKpiCard label="Cost per hire" value={<Money value={costSummary.costPerHire} />} icon={CircleDollarSign} tone="violet" />
            </div>

            <HrDataList
              rows={scoped.costs}
              columns={[
                { header: 'Head', mobile: 'title', cell: row => row.head },
                { header: 'Date', cell: row => row.incurredOn },
                { header: 'Invoice', className: 'hidden lg:table-cell', cell: row => row.invoiceRef || '—' },
                { header: 'Remarks', className: 'hidden xl:table-cell', cell: row => row.remarks || '—' },
                { header: 'Amount', align: 'right', cell: row => <Money value={row.amount} exact /> },
              ]}
              empty={<HrEmptyState icon={CircleDollarSign} title="No costs recorded" description="Agency fees, portal spend, travel and medical costs go here." />}
            />
          </HrSection>
        </TabsContent>

        {/* Notes */}
        <TabsContent value="notes">
          <HrSection
            title="Notes"
            description="Working notes for whoever picks this requirement up next."
            actions={
              permissions.can('Edit', 'Requirements') && (
                <Button size="sm" onClick={saveNotes} disabled={busy}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Save
                </Button>
              )
            }
          >
            <Textarea
              rows={8}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              disabled={!permissions.can('Edit', 'Requirements')}
            />
          </HrSection>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      <AssignRecruiterDialog
        open={assignOpen}
        requirement={requirement}
        users={users}
        onClose={() => setAssignOpen(false)}
      />

      <HoldDialog open={holdOpen} requirementId={requirementId} onClose={() => setHoldOpen(false)} />

      <CloseDialog
        open={closeOpen}
        requirement={requirement}
        closure={closure}
        onClose={() => setCloseOpen(false)}
      />

      <CancelDialog
        open={cancelOpen}
        requirement={requirement}
        balance={fill.balance}
        onClose={() => setCancelOpen(false)}
      />

      <CostDialog open={costOpen} requirement={requirement} onClose={() => setCostOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Job description (spec section 17)
 * ---------------------------------------------------------------------------------------------- */

function JobDescriptionTab({ requirement }: { requirement: HrRequirement }) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const permissions = useHrPermissions();
  const [purpose, setPurpose] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Seeded from the requirement rather than started blank (spec section 17): everything a JD needs
   * except the prose is already on the requisition, and retyping it is how the published JD ends up
   * disagreeing with the approved requirement.
   */
  const generated = useMemo(
    () =>
      [
        `Job title: ${requirement.jobTitle || requirement.designation}`,
        `Location: ${requirement.location || requirement.projectName || '—'}`,
        `Employment type: ${requirement.employmentType}`,
        `Reporting to: ${requirement.reportingToName || '—'}`,
        `Experience: ${requirement.minExperienceYears}${requirement.maxExperienceYears ? `–${requirement.maxExperienceYears}` : '+'} years`,
        `Qualification: ${requirement.qualification}${requirement.specialization ? ` (${requirement.specialization})` : ''}`,
        requirement.skills?.domain ? `Domain: ${requirement.skills.domain}` : '',
        requirement.skills?.primarySkills?.length ? `Technical skills: ${requirement.skills.primarySkills.join(', ')}` : '',
        requirement.skills?.mandatorySkills?.length ? `Mandatory: ${requirement.skills.mandatorySkills.join(', ')}` : '',
        requirement.travelRequirement ? `Travel: ${requirement.travelRequirement}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    [requirement],
  );

  const save = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      await logHrActivity({
        actor,
        entityType: 'jobDescription',
        entityId: requirement.id,
        requirementId: requirement.id,
        action: 'JD updated',
        summary: `Job description drafted for ${requirement.designation}`,
        newValue: { purpose, responsibilities },
      });
      toast({ title: 'Job description saved to the requirement activity' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HrSection
      title="Job description"
      description="Spec section 17 — seeded from the requirement so the published JD cannot drift from what was approved."
      actions={
        permissions.can('Edit', 'Job Descriptions') && (
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save draft
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <div>
          <Label className="text-xs">From the requirement</Label>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            {generated}
          </pre>
        </div>
        <div>
          <Label className="text-xs">Purpose of the role</Label>
          <Textarea rows={3} value={purpose} onChange={event => setPurpose(event.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Key responsibilities (one per line)</Label>
          <Textarea rows={6} value={responsibilities} onChange={event => setResponsibilities(event.target.value)} />
        </div>
      </div>
    </HrSection>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Workspace dialogs
 * ---------------------------------------------------------------------------------------------- */

function AssignRecruiterDialog({
  open,
  requirement,
  users,
  onClose,
}: {
  open: boolean;
  requirement: HrRequirement;
  users: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const [primary, setPrimary] = useState(requirement.primaryRecruiterId || '');
  const [secondary, setSecondary] = useState(requirement.secondaryRecruiterId || '');
  const [targetDate, setTargetDate] = useState(requirement.targetClosureDate || '');
  const [saving, setSaving] = useState(false);

  // Default the target date to today plus the priority's SLA, which is what the recruiter will be
  // measured against anyway (spec sections 15, 40).
  useEffect(() => {
    if (open && !targetDate) {
      const days = requirement.slaTargetDays || settings.sla.targets[requirement.priority] || settings.sla.targets.Normal;
      const date = new Date();
      date.setDate(date.getDate() + days);
      setTargetDate(date.toISOString().slice(0, 10));
    }
  }, [open, targetDate, requirement, settings]);

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await assignRecruiter(
        requirement.id,
        {
          primaryRecruiterId: primary,
          primaryRecruiterName: users.find(row => row.id === primary)?.name || 'Recruiter',
          secondaryRecruiterId: secondary || undefined,
          secondaryRecruiterName: users.find(row => row.id === secondary)?.name,
          targetClosureDate: targetDate,
        },
        actor,
      );
      toast({ title: 'Recruiter assigned', description: 'The requirement is now open for sourcing.' });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not assign',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Assign recruiter</DialogTitle>
          <DialogDescription>{requirement.requirementNumber} · {requirement.designation}</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Primary recruiter *</Label>
            <Select value={primary} onValueChange={setPrimary}>
              <SelectTrigger><SelectValue placeholder="Select recruiter" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {users.map(row => (
                  <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Secondary recruiter</Label>
            <Select value={secondary || 'none'} onValueChange={value => setSecondary(value === 'none' ? '' : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">None</SelectItem>
                {users.map(row => (
                  <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Target closure date</Label>
            <Input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !primary} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldDialog({ open, requirementId, onClose }: { open: boolean; requirementId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const [reason, setReason] = useState<RequirementHoldReason | ''>('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!actor || !reason) return;
    setSaving(true);
    try {
      await holdRequirement(requirementId, { reason, remarks }, actor);
      toast({
        title: 'Requirement on hold',
        description: settings.sla.pauseOnHold ? 'The SLA clock is paused.' : 'The SLA clock keeps running.',
      });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not hold',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Put the requirement on hold</DialogTitle>
          <DialogDescription>Spec section 42 — recruitment pauses, nothing is lost.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Hold reason *</Label>
            <Select value={reason} onValueChange={value => setReason(value as RequirementHoldReason)}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {REQUIREMENT_HOLD_REASONS.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea rows={3} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !reason} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Hold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  open,
  requirement,
  closure,
  onClose,
}: {
  open: boolean;
  requirement: HrRequirement;
  closure: ReturnType<typeof evaluateRequirementClosure>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [closureType, setClosureType] = useState<'Fully Filled' | 'Partially Filled'>(
    closure.canCloseFullyFilled ? 'Fully Filled' : 'Partially Filled',
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await closeRequirement(requirement.id, { closureType, reason }, actor);
      toast({ title: 'Requirement closed' });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not close',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Close {requirement.requirementNumber}</DialogTitle>
          <DialogDescription>Spec section 38 — checked against live offers and upcoming joinings.</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {closure.blockers.length > 0 && (
            <HrAlertNotice tone="rose" title="Cannot close yet">
              <ul className="list-disc pl-4">
                {closure.blockers.map(blocker => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </HrAlertNotice>
          )}
          {closure.warnings.length > 0 && (
            <HrAlertNotice tone="amber" title="Before you close">
              <ul className="list-disc pl-4">
                {closure.warnings.map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </HrAlertNotice>
          )}

          <div>
            <Label className="text-xs">Closure type *</Label>
            <Select value={closureType} onValueChange={value => setClosureType(value as typeof closureType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Fully Filled" disabled={!closure.canCloseFullyFilled}>
                  Close fully filled
                </SelectItem>
                <SelectItem value="Partially Filled">Close partially filled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Reason {closureType === 'Partially Filled' ? '*' : ''}</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={closureType === 'Partially Filled' ? 'Mandatory for a partial closure' : 'Optional'}
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving || closure.blockers.length > 0 || (closureType === 'Partially Filled' && !reason.trim())}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  requirement,
  balance,
  onClose,
}: {
  open: boolean;
  requirement: HrRequirement;
  balance: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [positions, setPositions] = useState(String(balance));
  const [disposition, setDisposition] = useState<'Talent Pool' | 'Rejected' | 'Leave As Is'>('Talent Pool');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const partial = Number(positions) < balance;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await cancelRequirement(
        requirement.id,
        { reason, positionsCancelled: Number(positions) || balance, candidateDisposition: disposition },
        actor,
      );
      toast({
        title: partial ? 'Positions cancelled' : 'Requirement cancelled',
        description: result.applicationsMoved
          ? `${result.applicationsMoved} candidates released to ${disposition.toLowerCase()}.`
          : undefined,
      });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not cancel',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Cancel {requirement.requirementNumber}</DialogTitle>
          <DialogDescription>
            Spec section 43 — nothing is deleted; candidates and approvals stay on the record.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Positions to cancel *</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={1}
              max={balance}
              value={positions}
              onChange={event => setPositions(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {balance} unfilled {balance === 1 ? 'position' : 'positions'} can be cancelled.
              {partial && ' Cancelling some leaves the requirement open for the rest.'}
            </p>
          </div>

          {!partial && (
            <div>
              <Label className="text-xs">What happens to the candidates</Label>
              <Select value={disposition} onValueChange={value => setDisposition(value as typeof disposition)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Talent Pool">Move to the talent pool</SelectItem>
                  <SelectItem value="Rejected">Mark as rejected</SelectItem>
                  <SelectItem value="Leave As Is">Leave them as they are</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The talent pool is the fairer default — the candidate did nothing wrong.
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs">Cancellation reason *</Label>
            <Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Keep it open</Button>
          <Button variant="destructive" onClick={submit} disabled={saving || !reason.trim()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {partial ? 'Cancel positions' : 'Cancel requirement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostDialog({ open, requirement, onClose }: { open: boolean; requirement: HrRequirement; onClose: () => void }) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [head, setHead] = useState<RecruitmentCostHead>('Agency Fee');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceRef, setInvoiceRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await recordRecruitmentCost(
        {
          requirementId: requirement.id,
          requirementNumber: requirement.requirementNumber,
          head,
          amount: Number(amount) || 0,
          incurredOn,
          invoiceRef,
          remarks,
        },
        actor,
      );
      toast({ title: 'Cost recorded' });
      setAmount('');
      setInvoiceRef('');
      setRemarks('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not record the cost',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Add recruitment cost</DialogTitle>
          <DialogDescription>{requirement.requirementNumber}</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyGrid}>
          <div>
            <Label className="text-xs">Cost head *</Label>
            <Select value={head} onValueChange={value => setHead(value as RecruitmentCostHead)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECRUITMENT_COST_HEADS.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Amount *</Label>
            <Input type="number" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Incurred on</Label>
            <Input type="date" value={incurredOn} onChange={event => setIncurredOn(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Invoice reference</Label>
            <Input value={invoiceRef} onChange={event => setInvoiceRef(event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea rows={2} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !(Number(amount) > 0)} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
