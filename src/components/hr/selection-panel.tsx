'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Check, Loader2, ThumbsDown, TrendingUp, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  ctcIncreasePercent,
  evaluateCtcAgainstBand,
  hrCurrency,
  type Candidate,
  type CandidateApplication,
  type CompensationApproval,
  type HrRequirement,
  type SelectionProposal,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  actOnCompensationApproval,
  createSelectionProposal,
  ctcBandForGrade,
} from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrField,
  HrLoader,
  HrPageHeader,
  HrStatusBadge,
  SensitiveMoney,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Selection proposals and compensation approvals — spec sections 27 and 28.
 *
 * The two live on one screen because they are one decision seen from two sides: HR proposes a
 * number, and where that number breaches the grade band the chain has to clear it before an offer
 * can exist (control rule 63.5). Splitting them across screens is how a proposal sits for a week
 * with nobody realising it is waiting on them.
 *
 * Every CTC figure here routes through `SensitiveMoney`, so a screen that a project HOD can open
 * shows them the selection without showing them the salary (control rule 63.12).
 */

export default function SelectionPanel({
  requirementId,
  embedded = false,
}: {
  requirementId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { settings, actor, users, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: proposals, loading } = useHrCollection<SelectionProposal>(HR_COLLECTIONS.selectionProposals);
  const { rows: approvals } = useHrCollection<CompensationApproval>(HR_COLLECTIONS.compensationApprovals);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: candidates } = useHrCollection<Candidate>(HR_COLLECTIONS.candidates);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [proposeFor, setProposeFor] = useState<CandidateApplication | null>(null);
  const [decideOn, setDecideOn] = useState<{ approval: CompensationApproval; action: 'Approve' | 'Reject' } | null>(null);

  const scoped = useMemo(
    () =>
      proposals
        .filter(proposal => (requirementId ? proposal.requirementId === requirementId : true))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [proposals, requirementId],
  );

  /** Candidates who have cleared interviews and have no proposal yet (spec section 27). */
  const readyForSelection = useMemo(() => {
    const withProposal = new Set(proposals.map(proposal => proposal.applicationId));
    return applications
      .filter(application => (requirementId ? application.requirementId === requirementId : true))
      .filter(application => ['SHORTLISTED', 'INTERVIEW_1', 'INTERVIEW_2', 'FINAL_INTERVIEW'].includes(application.stage))
      .filter(application => !withProposal.has(application.id));
  }, [applications, proposals, requirementId]);

  /** Compensation approvals waiting on the signed-in user. */
  const myApprovals = useMemo(
    () =>
      approvals.filter(
        approval =>
          approval.status === 'PENDING' &&
          (approval.pendingApproverIds || []).includes(actor?.userId || '') &&
          (requirementId ? approval.requirementId === requirementId : true),
      ),
    [approvals, actor, requirementId],
  );

  const columns: Array<HrListColumn<SelectionProposal>> = [
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
    { header: 'Grade', className: 'hidden lg:table-cell', cell: row => row.grade },
    {
      header: 'Current',
      align: 'right',
      className: 'hidden xl:table-cell',
      cell: row => <SensitiveMoney value={row.currentCtc} canView={permissions.canViewSalary} />,
    },
    {
      header: 'Proposed',
      align: 'right',
      cell: row => <SensitiveMoney value={row.proposedCtc} canView={permissions.canViewSalary} />,
    },
    {
      header: 'Increase',
      align: 'right',
      className: 'hidden lg:table-cell',
      cell: row =>
        permissions.canViewSalary && row.increasePercent ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <TrendingUp className="h-3 w-3 text-emerald-600" />
            {row.increasePercent}%
          </span>
        ) : (
          '—'
        ),
    },
    {
      header: 'Variance',
      align: 'right',
      cell: row =>
        row.ctcAboveBand ? (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            +{row.ctcVariancePercent}%
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">In band</span>
        ),
    },
    {
      header: 'Panel',
      className: 'hidden xl:table-cell',
      cell: row => (
        <span className="inline-flex items-center gap-1.5">
          {row.interviewScore ? `${row.interviewScore}/5` : '—'}
          {row.hasDissent && (
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">dissent</Badge>
          )}
        </span>
      ),
    },
    { header: 'Joining', className: 'hidden lg:table-cell', cell: row => row.proposedJoiningDate || '—' },
    { header: 'Status', mobile: 'aside', cell: row => <HrStatusBadge status={row.status} /> },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row => {
        const approval = approvals.find(entry => entry.id === row.compensationApprovalId);
        const mine = approval && approval.status === 'PENDING' && (approval.pendingApproverIds || []).includes(actor?.userId || '');
        if (!mine || !approval) {
          return row.status === 'APPROVED' && permissions.can('Add', 'Offers') ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/hr/offers?proposal=${row.id}`}>Create offer</Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        }
        return (
          <div className="flex gap-1.5">
            <Button size="sm" className="gap-1" onClick={() => setDecideOn({ approval, action: 'Approve' })}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-rose-700" onClick={() => setDecideOn({ approval, action: 'Reject' })}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading selections…" />;

  return (
    <div>
      {!embedded && (
        <HrPageHeader
          title="Selection & Compensation"
          description={`${scoped.length} ${scoped.length === 1 ? 'proposal' : 'proposals'}${
            myApprovals.length ? ` · ${myApprovals.length} awaiting your approval` : ''
          }`}
          actions={
            permissions.can('Add', 'Selection') &&
            readyForSelection.length > 0 && (
              <Button className="gap-2" onClick={() => setProposeFor(readyForSelection[0])}>
                <BadgeCheck className="h-4 w-4" /> Select Candidate
              </Button>
            )
          }
        />
      )}

      {myApprovals.length > 0 && (
        <div className="mb-3">
          <HrAlertNotice tone="amber" title="Awaiting your compensation approval">
            {myApprovals.length} {myApprovals.length === 1 ? 'proposal needs' : 'proposals need'} your decision. Each row
            below carries the Approve and Reject actions.
          </HrAlertNotice>
        </div>
      )}

      {/* Candidates who cleared interviews but have no proposal — the actual next action here. */}
      {permissions.can('Add', 'Selection') && readyForSelection.length > 0 && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">Ready for selection</p>
          <div className="flex flex-wrap gap-2">
            {readyForSelection.slice(0, 8).map(application => (
              <Button key={application.id} size="sm" variant="outline" className="gap-1.5 bg-white" onClick={() => setProposeFor(application)}>
                <BadgeCheck className="h-3.5 w-3.5" /> {application.candidateName}
                {application.latestInterviewScore ? (
                  <span className="text-[10px] text-muted-foreground">{application.latestInterviewScore}/5</span>
                ) : null}
              </Button>
            ))}
          </div>
        </div>
      )}

      <HrDataList
        rows={scoped}
        columns={columns}
        empty={
          <HrEmptyState
            icon={BadgeCheck}
            title="No selection proposals yet"
            description="Once a candidate clears the interview rounds, raise a selection proposal with the recommended CTC."
          />
        }
      />

      <ProposalDialog
        application={proposeFor}
        candidates={candidates}
        requirements={requirements}
        onClose={() => setProposeFor(null)}
      />

      <CompensationDecisionDialog
        target={decideOn}
        users={users}
        onClose={() => setDecideOn(null)}
        onDone={message => {
          setDecideOn(null);
          toast({ title: message });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Selection proposal (spec section 27)
 * ---------------------------------------------------------------------------------------------- */

function ProposalDialog({
  application,
  candidates,
  requirements,
  onClose,
}: {
  application: CandidateApplication | null;
  candidates: Candidate[];
  requirements: HrRequirement[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { settings, actor } = useHrConfig();
  const permissions = useHrPermissions();
  const [proposedCtc, setProposedCtc] = useState('');
  const [proposedJoiningDate, setProposedJoiningDate] = useState('');
  const [noticePeriodDays, setNoticePeriodDays] = useState('');
  const [relocationRequired, setRelocationRequired] = useState(false);
  const [relocationSupport, setRelocationSupport] = useState('');
  const [specialConditions, setSpecialConditions] = useState('');
  const [saving, setSaving] = useState(false);

  const candidate = candidates.find(row => row.id === application?.candidateId) || null;
  const requirement = requirements.find(row => row.id === application?.requirementId) || null;

  const band = requirement ? ctcBandForGrade(settings, requirement.grade) : { min: 0, max: 0 };
  const bandMin = requirement?.budget?.bandMin ?? band.min;
  const bandMax = requirement?.budget?.bandMax ?? band.max;

  const evaluation = useMemo(
    () =>
      evaluateCtcAgainstBand({
        proposedCtc: Number(proposedCtc) || 0,
        bandMin,
        bandMax,
        tolerancePercent: settings.compensation.tolerancePercent,
      }),
    [proposedCtc, bandMin, bandMax, settings.compensation.tolerancePercent],
  );

  const increase = ctcIncreasePercent(candidate?.currentCtc, Number(proposedCtc) || 0);

  const submit = async () => {
    if (!actor || !application) return;
    setSaving(true);
    try {
      const result = await createSelectionProposal(
        {
          applicationId: application.id,
          proposedCtc: Number(proposedCtc) || 0,
          proposedJoiningDate,
          noticePeriodDays: Number(noticePeriodDays) || undefined,
          relocationRequired,
          relocationSupport,
          specialConditions,
        },
        actor,
      );
      toast({
        title: 'Candidate selected',
        description: result.requiresCompensationApproval
          ? 'Compensation approval has been raised; the offer stays locked until it clears.'
          : 'The proposal is within band — you can create the offer now.',
      });
      setProposedCtc('');
      onClose();
    } catch (error) {
      toast({
        title: 'Could not raise the proposal',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!application) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Selection proposal — {application.candidateName}</DialogTitle>
          <DialogDescription>
            {application.requirementNumber} · {requirement?.designation} · {requirement?.grade}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:grid-cols-4">
            <HrField label="Current CTC">
              <SensitiveMoney value={candidate?.currentCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Expected CTC">
              <SensitiveMoney value={candidate?.expectedCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Budgeted CTC">
              <SensitiveMoney value={requirement?.budget?.expectedCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Approved band">
              {permissions.canViewSalary && bandMax > 0 ? `${hrCurrency(bandMin)} – ${hrCurrency(bandMax)}` : '₹ ••••'}
            </HrField>
            <HrField label="Interview score">{application.latestInterviewScore ? `${application.latestInterviewScore}/5` : '—'}</HrField>
            <HrField label="Panel recommendation">{application.panelRecommendation || '—'}</HrField>
            <HrField label="Notice period">
              {candidate?.noticePeriodDays ? `${candidate.noticePeriodDays} days` : '—'}
            </HrField>
            <HrField label="Source">{application.source}</HrField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Proposed CTC (annual) *</Label>
              <Input type="number" inputMode="decimal" value={proposedCtc} onChange={event => setProposedCtc(event.target.value)} />
              {Number(proposedCtc) > 0 && candidate?.currentCtc ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {increase >= 0 ? 'Increase' : 'Decrease'} of {Math.abs(increase)}% over the current CTC.
                </p>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Proposed joining date</Label>
              <Input type="date" value={proposedJoiningDate} onChange={event => setProposedJoiningDate(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notice period (days)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={noticePeriodDays}
                onChange={event => setNoticePeriodDays(event.target.value)}
                placeholder={candidate?.noticePeriodDays ? String(candidate.noticePeriodDays) : ''}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2">
                <Checkbox checked={relocationRequired} onCheckedChange={value => setRelocationRequired(value === true)} />
                <span className="text-sm">Relocation required</span>
              </label>
            </div>
            {relocationRequired && (
              <div className="sm:col-span-2">
                <Label className="text-xs">Relocation support</Label>
                <Input value={relocationSupport} onChange={event => setRelocationSupport(event.target.value)} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label className="text-xs">Special conditions</Label>
              <Textarea rows={2} value={specialConditions} onChange={event => setSpecialConditions(event.target.value)} />
            </div>
          </div>

          {Number(proposedCtc) > 0 && bandMax > 0 && (
            evaluation.requiresApproval ? (
              <HrAlertNotice tone="rose" title="Compensation approval required">
                {evaluation.message} The offer stays locked until{' '}
                {(settings.compensation.approvalStages || []).map(stage => stage.key.replace(/_/g, ' ').toLowerCase()).join(' → ')}{' '}
                have cleared it.
              </HrAlertNotice>
            ) : (
              <HrAlertNotice tone="emerald" title="Within band">
                {evaluation.message} No compensation approval is needed.
              </HrAlertNotice>
            )
          )}

          {application.panelRecommendation === 'Not Recommended' && (
            <HrAlertNotice tone="rose" title="Panel did not recommend">
              The interview panel did not recommend this candidate. Selecting them anyway is possible, but
              the panel&apos;s view stays on the record.
            </HrAlertNotice>
          )}
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !(Number(proposedCtc) > 0)} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Raise proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Compensation decision (spec section 28)
 * ---------------------------------------------------------------------------------------------- */

function CompensationDecisionDialog({
  target,
  users,
  onClose,
  onDone,
}: {
  target: { approval: CompensationApproval; action: 'Approve' | 'Reject' } | null;
  users: Array<{ id: string; name: string; role?: string }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const permissions = useHrPermissions();
  const [approvedCtc, setApprovedCtc] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  if (!target) return null;
  const { approval, action } = target;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await actOnCompensationApproval(approval.id, action, actor, {
        approvedCtc: approvedCtc ? Number(approvedCtc) : undefined,
        remarks,
        context: { roleByUserId: Object.fromEntries(users.map(row => [row.id, row.role || ''])) },
      });
      onDone(
        action === 'Reject'
          ? 'Compensation rejected'
          : result.status === 'APPROVED'
            ? 'Compensation approved — the offer can now be created'
            : `Approved; now with ${result.stageLabel}`,
      );
      setApprovedCtc('');
      setRemarks('');
    } catch (error) {
      toast({
        title: 'Could not record the decision',
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
          <DialogTitle>
            {action === 'Approve' ? 'Approve compensation' : 'Reject compensation'} — {approval.candidateName}
          </DialogTitle>
          <DialogDescription>
            {approval.currentStageLabel} · proposed{' '}
            {permissions.canViewSalary ? hrCurrency(approval.proposedCtc) : '₹ ••••'}
            {approval.variancePercent ? ` · ${approval.variancePercent}% above band` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <HrField label="Proposed">
              <SensitiveMoney value={approval.proposedCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Budgeted">
              <SensitiveMoney value={approval.budgetedCtc} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Band maximum">
              <SensitiveMoney value={approval.bandMax} canView={permissions.canViewSalary} />
            </HrField>
            <HrField label="Variance">{approval.variancePercent ? `+${approval.variancePercent}%` : '—'}</HrField>
          </div>

          {action === 'Approve' && (
            <div>
              <Label className="text-xs">Approved CTC</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={approvedCtc}
                onChange={event => setApprovedCtc(event.target.value)}
                placeholder={String(approval.proposedCtc)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave blank to approve the proposed figure. You may approve a lower amount, but not a higher one.
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs">Remarks {action === 'Reject' ? '*' : ''}</Label>
            <Textarea rows={3} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={action === 'Reject' ? 'destructive' : 'default'}
            onClick={submit}
            disabled={saving || (action === 'Reject' && !remarks.trim())}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : action === 'Reject' ? <ThumbsDown className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
