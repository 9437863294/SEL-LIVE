'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  FolderKanban,
  Loader2,
  MoreVertical,
  Phone,
  Plus,
  Search,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  HR_COLLECTIONS,
  PIPELINE_EXITS,
  PIPELINE_STAGES,
  RECRUITMENT_SOURCES,
  SCREENING_RESULTS,
  evaluateStageMove,
  hrStatusLabel,
  isPipelineExit,
  type ApplicationStage,
  type Candidate,
  type CandidateApplication,
  type HrRequirement,
  type PipelineStage,
  type RecruitmentSourceKind,
  type ScreeningResult,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  createApplication,
  moveApplicationStage,
  recordScreening,
} from '@/lib/hr-requirement-service';
import { HrEmptyState, HrLoader, HrPageHeader, HrStatusBadge, hrDialog } from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The recruitment pipeline of spec section 22.
 *
 * One implementation serves both the standalone board and the Candidates/Pipeline tabs of the
 * requirement workspace (section 16) — pass a `requirementId` to scope it. Building the workspace
 * its own board is how the two would end up disagreeing about which stage moves are legal.
 *
 * Cards move by drag on a desktop and by an explicit menu everywhere: HTML5 drag events never fire
 * on touch, so a drag-only board is a board a recruiter cannot use from a site visit. Both paths go
 * through `moveApplicationStage`, so the gates of control rule 63.5 hold either way.
 */

const STAGE_TONE: Record<PipelineStage, string> = {
  NEW: 'border-slate-200 bg-slate-50',
  SCREENING: 'border-indigo-200 bg-indigo-50/60',
  SHORTLISTED: 'border-indigo-200 bg-indigo-50/60',
  INTERVIEW_1: 'border-blue-200 bg-blue-50/60',
  INTERVIEW_2: 'border-blue-200 bg-blue-50/60',
  FINAL_INTERVIEW: 'border-blue-200 bg-blue-50/60',
  SELECTED: 'border-emerald-200 bg-emerald-50/60',
  COMPENSATION_APPROVAL: 'border-amber-200 bg-amber-50/60',
  OFFERED: 'border-violet-200 bg-violet-50/60',
  OFFER_ACCEPTED: 'border-violet-200 bg-violet-50/60',
  PRE_JOINING: 'border-teal-200 bg-teal-50/60',
  JOINED: 'border-green-200 bg-green-50/60',
};

export default function PipelineBoard({
  requirementId,
  embedded = false,
}: {
  requirementId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: applications, loading } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);

  const [selectedRequirement, setSelectedRequirement] = useState<string>(requirementId || 'all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [screeningFor, setScreeningFor] = useState<CandidateApplication | null>(null);
  const [exitFor, setExitFor] = useState<{ application: CandidateApplication; stage: ApplicationStage } | null>(null);

  const scopedRequirementId = requirementId || (selectedRequirement === 'all' ? '' : selectedRequirement);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications
      .filter(application => (scopedRequirementId ? application.requirementId === scopedRequirementId : true))
      .filter(application =>
        term
          ? [application.candidateName, application.candidateMobile, application.requirementNumber, application.designation]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)
          : true,
      );
  }, [applications, scopedRequirementId, search]);

  const byStage = useMemo(() => {
    const map = new Map<ApplicationStage, CandidateApplication[]>();
    [...PIPELINE_STAGES, ...PIPELINE_EXITS].forEach(stage => map.set(stage, []));
    for (const application of visible) {
      const bucket = map.get(application.stage);
      if (bucket) bucket.push(application);
      else map.set(application.stage, [application]);
    }
    return map;
  }, [visible]);

  const exitCounts = PIPELINE_EXITS.map(stage => ({ stage, count: byStage.get(stage)?.length || 0 })).filter(row => row.count > 0);

  const canMove = permissions.can('Move Stage', 'Pipeline');

  const performMove = async (application: CandidateApplication, to: ApplicationStage, reason?: string, remarks?: string) => {
    if (!actor) return;
    setBusyId(application.id);
    try {
      await moveApplicationStage(application.id, to, actor, { reason, remarks });
      toast({ title: 'Stage updated', description: `${application.candidateName} moved to ${hrStatusLabel(to)}.` });
    } catch (error) {
      toast({
        title: 'Could not move the candidate',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const requestMove = (application: CandidateApplication, to: ApplicationStage) => {
    if (!canMove) {
      toast({ title: 'Not permitted', description: 'You cannot move candidates between stages.', variant: 'destructive' });
      return;
    }
    // Screening and the exits both need something written down, so they open a dialog instead of
    // moving silently — an exit with no reason is a pipeline nobody can learn from (section 53).
    if (to === 'SCREENING' && application.stage === 'NEW') {
      setScreeningFor(application);
      return;
    }
    if (isPipelineExit(to)) {
      setExitFor({ application, stage: to });
      return;
    }
    const check = evaluateStageMove({ from: application.stage, to });
    if (!check.allowed) {
      toast({ title: 'Not allowed', description: check.reason, variant: 'destructive' });
      return;
    }
    void performMove(application, to);
  };

  if (loading || configLoading) return <HrLoader label="Loading pipeline…" />;

  const board = (
    <div className="hr-pipeline-board">
      {PIPELINE_STAGES.map(stage => {
        const rows = byStage.get(stage) || [];
        return (
          <div
            key={stage}
            onDragOver={event => {
              if (!canMove) return;
              event.preventDefault();
              setDragOverStage(stage);
            }}
            onDragLeave={() => setDragOverStage(current => (current === stage ? null : current))}
            onDrop={event => {
              event.preventDefault();
              setDragOverStage(null);
              const applicationId = event.dataTransfer.getData('text/plain');
              const application = visible.find(row => row.id === applicationId);
              if (application && application.stage !== stage) requestMove(application, stage);
            }}
            className={cn(
              'rounded-xl border p-2 transition-colors',
              STAGE_TONE[stage],
              dragOverStage === stage && 'ring-2 ring-indigo-400 ring-offset-1',
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {hrStatusLabel(stage)}
              </p>
              <Badge variant="secondary" className="shrink-0 tabular-nums">{rows.length}</Badge>
            </div>

            <div className="space-y-2">
              {rows.map(application => (
                <div
                  key={application.id}
                  draggable={canMove}
                  onDragStart={event => event.dataTransfer.setData('text/plain', application.id)}
                  className="rounded-lg border border-white/80 bg-white p-2.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <Link
                        href={`/hr/candidates/${application.candidateId}`}
                        className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline"
                      >
                        {application.candidateName}
                      </Link>
                      {!scopedRequirementId && (
                        <p className="truncate text-[11px] text-muted-foreground">{application.requirementNumber}</p>
                      )}
                    </div>
                    {busyId === application.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                    ) : (
                      canMove && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                            <DropdownMenuLabel className="text-xs">Move to stage</DropdownMenuLabel>
                            {PIPELINE_STAGES.filter(target => target !== application.stage).map(target => {
                              const check = evaluateStageMove({ from: application.stage, to: target });
                              return (
                                <DropdownMenuItem
                                  key={target}
                                  disabled={!check.allowed}
                                  onClick={() => requestMove(application, target)}
                                  className="text-xs"
                                >
                                  <ChevronRight className="mr-1 h-3 w-3" />
                                  {hrStatusLabel(target)}
                                </DropdownMenuItem>
                              );
                            })}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs">Exit pipeline</DropdownMenuLabel>
                            {PIPELINE_EXITS.map(target => (
                              <DropdownMenuItem key={target} onClick={() => requestMove(application, target)} className="text-xs">
                                {hrStatusLabel(target)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {application.candidateMobile && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {application.candidateMobile}
                      </span>
                    )}
                    {application.latestInterviewScore ? (
                      <Badge variant="outline" className="h-4 border-blue-200 bg-blue-50 px-1 text-[10px] text-blue-700">
                        {application.latestInterviewScore}/5
                      </Badge>
                    ) : null}
                    {application.isInternal && (
                      <Badge variant="outline" className="h-4 border-cyan-200 bg-cyan-50 px-1 text-[10px] text-cyan-700">
                        Internal
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{application.source}</p>
                </div>
              ))}

              {rows.length === 0 && (
                <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">No candidates</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {!embedded && (
        <HrPageHeader
          title="Recruitment Pipeline"
          description={`${visible.length} live ${visible.length === 1 ? 'application' : 'applications'}`}
          actions={
            permissions.can('Add Candidate', 'Pipeline') && (
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add Candidate
              </Button>
            )
          }
        />
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        {!requirementId && (
          <div className="sm:w-72">
            <Label className="text-xs">Requirement</Label>
            <Select value={selectedRequirement} onValueChange={setSelectedRequirement}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All requirements</SelectItem>
                {requirements.map(requirement => (
                  <SelectItem key={requirement.id} value={requirement.id}>
                    {requirement.requirementNumber} · {requirement.designation}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex-1">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Candidate, mobile, requirement…" className="pl-8" />
          </div>
        </div>
        {embedded && permissions.can('Add Candidate', 'Pipeline') && (
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Candidate
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <HrEmptyState
          icon={FolderKanban}
          title="No candidates in this pipeline yet"
          description="Add a candidate from the database, or source one against this requirement."
          action={
            permissions.can('Add Candidate', 'Pipeline') ? (
              <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add Candidate
              </Button>
            ) : undefined
          }
        />
      ) : (
        board
      )}

      {/* The side exits of section 22, summarised under the board rather than as twelve more columns. */}
      {exitCounts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Exited</span>
          {exitCounts.map(row => (
            <Badge key={row.stage} variant="outline" className="gap-1">
              {hrStatusLabel(row.stage)} <span className="tabular-nums font-semibold">{row.count}</span>
            </Badge>
          ))}
        </div>
      )}

      <AddCandidateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        requirementId={scopedRequirementId}
        requirements={requirements}
        candidates={candidates}
        existingApplications={applications}
      />

      <ScreeningDialog
        application={screeningFor}
        onClose={() => setScreeningFor(null)}
        candidate={candidates.find(row => row.id === screeningFor?.candidateId) || null}
      />

      <ExitDialog
        target={exitFor}
        onClose={() => setExitFor(null)}
        onConfirm={async (application, stage, reason, remarks) => {
          setExitFor(null);
          await performMove(application, stage, reason, remarks);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Add candidate to a requirement (spec section 21)
 * ---------------------------------------------------------------------------------------------- */

function AddCandidateDialog({
  open,
  onOpenChange,
  requirementId,
  requirements,
  candidates,
  existingApplications,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirementId: string;
  requirements: HrRequirement[];
  candidates: Candidate[];
  existingApplications: CandidateApplication[];
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [targetRequirement, setTargetRequirement] = useState(requirementId);
  const [candidateId, setCandidateId] = useState('');
  const [source, setSource] = useState<RecruitmentSourceKind | ''>('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const effectiveRequirement = requirementId || targetRequirement;
  const candidate = candidates.find(row => row.id === candidateId) || null;

  /** Candidates already in this requirement's live pipeline are hidden — control rule 63.8. */
  const available = useMemo(() => {
    const already = new Set(
      existingApplications
        .filter(application => application.requirementId === effectiveRequirement && PIPELINE_STAGES.includes(application.stage as never))
        .map(application => application.candidateId),
    );
    const term = search.trim().toLowerCase();
    return candidates
      .filter(row => !already.has(row.id) && !row.doNotHire)
      .filter(row =>
        term ? [row.name, row.mobile, row.email, row.currentCompany].filter(Boolean).join(' ').toLowerCase().includes(term) : true,
      )
      .slice(0, 50);
  }, [candidates, existingApplications, effectiveRequirement, search]);

  const submit = async () => {
    if (!actor) return;
    if (!effectiveRequirement) {
      toast({ title: 'Select a requirement', variant: 'destructive' });
      return;
    }
    if (!candidateId) {
      toast({ title: 'Select a candidate', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createApplication(
        { requirementId: effectiveRequirement, candidateId, source: (source || undefined) as RecruitmentSourceKind | undefined },
        actor,
      );
      toast({ title: 'Candidate added', description: `${candidate?.name} is now in the pipeline.` });
      setCandidateId('');
      setSource('');
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Could not add the candidate',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Add candidate to pipeline</DialogTitle>
          <DialogDescription>
            A candidate exists once in the master and applies to as many requirements as needed.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {!requirementId && (
            <div>
              <Label className="text-xs">Requirement *</Label>
              <Select value={targetRequirement} onValueChange={setTargetRequirement}>
                <SelectTrigger><SelectValue placeholder="Select requirement" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {requirements.map(requirement => (
                    <SelectItem key={requirement.id} value={requirement.id}>
                      {requirement.requirementNumber} · {requirement.designation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">Search candidates</Label>
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, mobile, email, company" />
          </div>

          <div>
            <Label className="text-xs">Candidate *</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder={available.length ? 'Select candidate' : 'No matching candidates'} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {available.map(row => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name} · {row.mobile || row.email} {row.currentDesignation ? `· ${row.currentDesignation}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Not in the list?{' '}
              <Link href="/hr/candidates" className="font-medium text-indigo-700 underline">
                Add them to the candidate database
              </Link>{' '}
              first.
            </p>
          </div>

          <div>
            <Label className="text-xs">Source for this application</Label>
            <Select value={source || 'inherit'} onValueChange={value => setSource(value === 'inherit' ? '' : (value as RecruitmentSourceKind))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Use the candidate&apos;s source{candidate ? ` (${candidate.source})` : ''}</SelectItem>
                {RECRUITMENT_SOURCES.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add to pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * HR screening (spec section 23)
 * ---------------------------------------------------------------------------------------------- */

function ScreeningDialog({
  application,
  candidate,
  onClose,
}: {
  application: CandidateApplication | null;
  candidate: Candidate | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const permissions = useHrPermissions();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    qualificationMatch: true,
    experienceMatch: true,
    skillMatch: true,
    currentCtc: '',
    expectedCtc: '',
    noticePeriodDays: '',
    locationWilling: true,
    siteWilling: true,
    reasonForChange: '',
    communicationAssessment: '',
    interviewAvailability: '',
    recruiterRecommendation: '',
    result: 'Shortlist' as ScreeningResult,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!actor || !application) return;
    setSaving(true);
    try {
      await recordScreening(
        application.id,
        {
          qualificationMatch: form.qualificationMatch,
          experienceMatch: form.experienceMatch,
          skillMatch: form.skillMatch,
          currentCtc: Number(form.currentCtc) || candidate?.currentCtc || 0,
          expectedCtc: Number(form.expectedCtc) || candidate?.expectedCtc || 0,
          noticePeriodDays: Number(form.noticePeriodDays) || candidate?.noticePeriodDays || 0,
          locationWilling: form.locationWilling,
          siteWilling: form.siteWilling,
          reasonForChange: form.reasonForChange,
          communicationAssessment: form.communicationAssessment,
          interviewAvailability: form.interviewAvailability,
          recruiterRecommendation: form.recruiterRecommendation,
          result: form.result,
        },
        actor,
      );
      toast({ title: 'Screening recorded', description: `${application.candidateName} — ${form.result}.` });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not save the screening',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!application) return null;
  if (!permissions.can('Screen', 'Pipeline')) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className={hrDialog.content}>
          <DialogHeader className={hrDialog.header}>
            <DialogTitle>Screening</DialogTitle>
            <DialogDescription>You do not have permission to screen candidates.</DialogDescription>
          </DialogHeader>
          <DialogFooter className={hrDialog.footer}>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Screen {application.candidateName}</DialogTitle>
          <DialogDescription>{application.requirementNumber} · {application.designation}</DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyGrid}>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex flex-wrap gap-4">
              {([
                ['qualificationMatch', 'Qualification matches'],
                ['experienceMatch', 'Experience matches'],
                ['skillMatch', 'Skills match'],
                ['locationWilling', 'Willing for the location'],
                ['siteWilling', 'Willing for site postings'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <Checkbox checked={form[key]} onCheckedChange={value => set(key, value === true)} />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Current CTC</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={form.currentCtc}
              onChange={event => set('currentCtc', event.target.value)}
              placeholder={candidate?.currentCtc ? String(candidate.currentCtc) : ''}
            />
          </div>
          <div>
            <Label className="text-xs">Expected CTC</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={form.expectedCtc}
              onChange={event => set('expectedCtc', event.target.value)}
              placeholder={candidate?.expectedCtc ? String(candidate.expectedCtc) : ''}
            />
          </div>
          <div>
            <Label className="text-xs">Notice period (days)</Label>
            <Input type="number" inputMode="decimal" value={form.noticePeriodDays} onChange={event => set('noticePeriodDays', event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Interview availability</Label>
            <Input value={form.interviewAvailability} onChange={event => set('interviewAvailability', event.target.value)} placeholder="e.g. weekdays after 6pm" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Reason for change</Label>
            <Textarea rows={2} value={form.reasonForChange} onChange={event => set('reasonForChange', event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Communication assessment</Label>
            <Input value={form.communicationAssessment} onChange={event => set('communicationAssessment', event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Recruiter recommendation</Label>
            <Textarea rows={2} value={form.recruiterRecommendation} onChange={event => set('recruiterRecommendation', event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Result *</Label>
            <Select value={form.result} onValueChange={value => set('result', value as ScreeningResult)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCREENING_RESULTS.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save screening
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Pipeline exit (spec section 22)
 * ---------------------------------------------------------------------------------------------- */

function ExitDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: { application: CandidateApplication; stage: ApplicationStage } | null;
  onClose: () => void;
  onConfirm: (application: CandidateApplication, stage: ApplicationStage, reason: string, remarks: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  if (!target) return null;

  const submit = async () => {
    setSaving(true);
    await onConfirm(target.application, target.stage, reason, remarks);
    setSaving(false);
    setReason('');
    setRemarks('');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{hrStatusLabel(target.stage)}</DialogTitle>
          <DialogDescription>
            {target.application.candidateName} will leave the pipeline for {target.application.requirementNumber}.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div>
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Experience mismatch" />
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea rows={3} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
          {target.stage === 'TALENT_POOL' && (
            <p className="text-xs text-muted-foreground">
              The candidate will also be added to the talent pool, so a future requirement for this
              designation surfaces them automatically.
            </p>
          )}
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={target.stage === 'REJECTED' ? 'destructive' : 'default'} onClick={submit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A compact stage badge, for the candidate detail and register screens. */
export function ApplicationStageBadge({ stage }: { stage: ApplicationStage }) {
  return <HrStatusBadge status={stage} />;
}
