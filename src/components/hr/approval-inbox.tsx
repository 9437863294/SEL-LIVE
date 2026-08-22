'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  Check,
  CircleHelp,
  ClipboardCheck,
  CornerUpLeft,
  Loader2,
  UserCheck,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  APPROVAL_ACTIONS_REQUIRING_REMARKS,
  HR_COLLECTIONS,
  PENDING_APPROVAL_STATUSES,
  annualManpowerCost,
  dayDifference,
  findDuplicateRequirements,
  hrCurrency,
  type ApprovalAction,
  type CompensationApproval,
  type HrRequirement,
} from '@/lib/hr-requirement';
import { HrControlError, actOnRequirement } from '@/lib/hr-requirement-service';
import {
  HrAlertNotice,
  HrEmptyState,
  HrField,
  HrLoader,
  HrPageHeader,
  HrPriorityBadge,
  HrSection,
  HrStatusBadge,
  SensitiveMoney,
  hrDialog,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The approval inbox of spec section 14.
 *
 * The screen's whole point is what an approver sees *before* deciding. The spec is emphatic that
 * Approve/Reject alone is not enough, so each card carries the department's sanctioned position, the
 * annual cost of the request, the justification, and any similar open requirement — the four things
 * that most often turn an approval into a question. Approving without opening the requirement should
 * be a defensible act, not a rubber stamp.
 *
 * Authority comes from the assignment: a requirement lists its pending approvers, and if the signed-in
 * user is one of them they may act. The service enforces the same rule, so nothing here can grant an
 * approval the chain did not.
 */

export default function ApprovalInbox() {
  const { toast } = useToast();
  const { settings, users, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: compensationApprovals } = useHrCollection<CompensationApproval>(HR_COLLECTIONS.compensationApprovals);

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [acting, setActing] = useState<{ requirement: HrRequirement; action: ApprovalAction } | null>(null);

  const pending = useMemo(
    () =>
      requirements
        .filter(requirement => PENDING_APPROVAL_STATUSES.includes(requirement.status))
        .filter(requirement => (scope === 'mine' ? (requirement.pendingApproverIds || []).includes(actor?.userId || '') : true))
        .sort((a, b) => (a.submittedAt?.toMillis?.() || 0) - (b.submittedAt?.toMillis?.() || 0)),
    [requirements, scope, actor],
  );

  const myCompensation = useMemo(
    () =>
      compensationApprovals.filter(
        approval => approval.status === 'PENDING' && (approval.pendingApproverIds || []).includes(actor?.userId || ''),
      ),
    [compensationApprovals, actor],
  );

  if (loading || configLoading) return <HrLoader label="Loading approvals…" />;

  return (
    <div>
      <HrPageHeader
        title="Approval Inbox"
        description={`${pending.length} manpower ${pending.length === 1 ? 'requirement' : 'requirements'} awaiting a decision`}
      />

      {myCompensation.length > 0 && (
        <div className="mb-3">
          <HrAlertNotice tone="amber" title="Compensation approvals">
            {myCompensation.length} {myCompensation.length === 1 ? 'proposal' : 'proposals'} also need your compensation
            decision.{' '}
            <Link href="/hr/selection" className="font-semibold underline">
              Open the selection desk
            </Link>
            .
          </HrAlertNotice>
        </div>
      )}

      <Tabs value={scope} onValueChange={value => setScope(value as typeof scope)} className="mb-3">
        <TabsList>
          <TabsTrigger value="mine">
            Awaiting me
            <Badge variant="secondary" className="ml-1.5 tabular-nums">
              {requirements.filter(row => PENDING_APPROVAL_STATUSES.includes(row.status) && (row.pendingApproverIds || []).includes(actor?.userId || '')).length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="all">All pending</TabsTrigger>
        </TabsList>
      </Tabs>

      {pending.length === 0 ? (
        <HrEmptyState
          icon={ClipboardCheck}
          title={scope === 'mine' ? 'Nothing awaiting your approval' : 'No requirements are pending approval'}
          description="Submitted requirements appear here for whoever the approval matrix routes them to."
        />
      ) : (
        <div className="space-y-3">
          {pending.map(requirement => (
            <ApprovalCard
              key={requirement.id}
              requirement={requirement}
              allRequirements={requirements}
              users={users}
              canViewSalary={permissions.canViewSalary}
              isMine={(requirement.pendingApproverIds || []).includes(actor?.userId || '')}
              onAct={action => setActing({ requirement, action })}
              slaTargets={settings.sla.targets}
            />
          ))}
        </div>
      )}

      <DecisionDialog
        target={acting}
        users={users}
        onClose={() => setActing(null)}
        onDone={message => {
          setActing(null);
          toast({ title: message });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * One requirement, with everything an approver needs to decide (spec section 14)
 * ---------------------------------------------------------------------------------------------- */

function ApprovalCard({
  requirement,
  allRequirements,
  users,
  canViewSalary,
  isMine,
  onAct,
  slaTargets,
}: {
  requirement: HrRequirement;
  allRequirements: HrRequirement[];
  users: Array<{ id: string; name: string }>;
  canViewSalary: boolean;
  isMine: boolean;
  onAct: (action: ApprovalAction) => void;
  slaTargets: Record<string, number>;
}) {
  const permissions = useHrPermissions();

  const similar = useMemo(
    () =>
      findDuplicateRequirements(
        {
          departmentId: requirement.departmentId,
          designation: requirement.designation,
          projectId: requirement.projectId,
          location: requirement.location,
        },
        allRequirements,
        { excludeId: requirement.id },
      ),
    [requirement, allRequirements],
  );

  const submittedDaysAgo = requirement.submittedAt?.toDate?.()
    ? Math.max(0, dayDifference(requirement.submittedAt.toDate(), new Date()))
    : 0;

  const annualCost = annualManpowerCost({
    expectedCtc: requirement.budget?.expectedCtc,
    quantity: requirement.requestedQuantity,
  });

  return (
    <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/hr/requirements/${requirement.id}`} className="text-sm font-semibold text-indigo-700 hover:underline">
                {requirement.requirementNumber}
              </Link>
              <HrStatusBadge status={requirement.status} />
              <HrPriorityBadge priority={requirement.priority} />
              {requirement.fastTrack && (
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Fast track</Badge>
              )}
              {submittedDaysAgo > 2 && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  Waiting {submittedDaysAgo}d
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {requirement.requestedQuantity} × {requirement.designation} · {requirement.grade}
            </p>
            <p className="text-xs text-muted-foreground">
              {requirement.departmentName}
              {requirement.projectName ? ` · ${requirement.projectName}` : ''}
              {requirement.location ? ` · ${requirement.location}` : ''} · requested by{' '}
              {requirement.requestingManagerName}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {isMine ? (
              <>
                {permissions.can('Approve', 'Approvals') && (
                  <Button size="sm" className="gap-1.5" onClick={() => onAct('Approve')}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                )}
                {permissions.can('Approve With Condition', 'Approvals') && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onAct('Approve With Condition')}>
                    <UserCheck className="h-3.5 w-3.5" /> With condition
                  </Button>
                )}
                {permissions.can('Send Back', 'Approvals') && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onAct('Send Back')}>
                    <CornerUpLeft className="h-3.5 w-3.5" /> Send back
                  </Button>
                )}
                {permissions.can('Request Clarification', 'Approvals') && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onAct('Request Clarification')}>
                    <CircleHelp className="h-3.5 w-3.5" /> Clarify
                  </Button>
                )}
                {permissions.can('Delegate', 'Approvals') && (
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onAct('Delegate')}>
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Delegate
                  </Button>
                )}
                {permissions.can('Reject', 'Approvals') && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-700" onClick={() => onAct('Reject')}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                )}
              </>
            ) : (
              <div className="text-right text-xs text-muted-foreground">
                <p className="font-medium text-slate-700">{requirement.currentApprovalStageLabel || 'Awaiting approval'}</p>
                <p>
                  {(requirement.pendingApproverIds || [])
                    .map(id => users.find(row => row.id === id)?.name || 'approver')
                    .join(', ') || '—'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* The decision context of section 14. */}
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 lg:grid-cols-4">
          <HrField label="Requirement type">{requirement.requirementType}</HrField>
          <HrField label="Employment type">{requirement.employmentType}</HrField>
          <HrField label="Required joining">{requirement.requiredJoiningDate}</HrField>
          <HrField label="SLA target">
            {requirement.slaTargetDays || slaTargets[requirement.priority] || '—'} days
          </HrField>
          <HrField label="Expected CTC">
            <SensitiveMoney value={requirement.budget?.expectedCtc} canView={canViewSalary} />
          </HrField>
          <HrField label="Annual manpower cost">
            <SensitiveMoney value={annualCost} canView={canViewSalary} />
          </HrField>
          <HrField label="Approved band">
            {canViewSalary && requirement.budget?.bandMax
              ? `${hrCurrency(requirement.budget.bandMin)} – ${hrCurrency(requirement.budget.bandMax)}`
              : '₹ ••••'}
          </HrField>
          <HrField label="Routed by">{requirement.approvalRuleName || '—'}</HrField>
        </div>

        {requirement.budget?.ctcAboveBand && (
          <div className="mt-3">
            <HrAlertNotice tone="rose" title="CTC above band">
              The expected CTC is {requirement.budget.ctcVariancePercent}% above the approved band for{' '}
              {requirement.grade}.
            </HrAlertNotice>
          </div>
        )}

        {requirement.replacement && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Replacement</p>
            <p className="mt-0.5 text-sm text-slate-800">
              {requirement.replacement.employeeName}
              {requirement.replacement.employeeCode ? ` (${requirement.replacement.employeeCode})` : ''} ·{' '}
              {requirement.replacement.reason}
              {requirement.replacement.lastWorkingDate ? ` · last working ${requirement.replacement.lastWorkingDate}` : ''}
            </p>
          </div>
        )}

        {requirement.justification?.businessJustification && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Justification</p>
            <p className="mt-0.5 text-sm text-slate-700">{requirement.justification.businessJustification}</p>
            {requirement.justification.impactIfVacant && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium">If vacant: </span>
                {requirement.justification.impactIfVacant}
              </p>
            )}
          </div>
        )}

        {similar.length > 0 && (
          <div className="mt-3">
            <HrAlertNotice tone="amber" title="Similar open requirements">
              {similar.slice(0, 3).map(match => (
                <span key={match.requirement.id} className="mr-2">
                  <Link href={`/hr/requirements/${match.requirement.id}`} className="font-semibold underline">
                    {match.requirement.requirementNumber}
                  </Link>{' '}
                  ({match.requirement.requestedQuantity} × {match.requirement.designation})
                </span>
              ))}
            </HrAlertNotice>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Decision dialog
 * ---------------------------------------------------------------------------------------------- */

function DecisionDialog({
  target,
  users,
  onClose,
  onDone,
}: {
  target: { requirement: HrRequirement; action: ApprovalAction } | null;
  users: Array<{ id: string; name: string; role?: string }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { toast } = useToast();
  const { actor } = useHrConfig();
  const [remarks, setRemarks] = useState('');
  const [condition, setCondition] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [saving, setSaving] = useState(false);

  if (!target) return null;
  const { requirement, action } = target;

  const needsRemarks = APPROVAL_ACTIONS_REQUIRING_REMARKS.includes(action);
  const needsDelegate = action === 'Forward' || action === 'Delegate';

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      const result = await actOnRequirement(requirement.id, action, actor, {
        remarks,
        condition: action === 'Approve With Condition' ? condition : undefined,
        forwardToUserId: needsDelegate ? forwardTo : undefined,
        forwardToUserName: needsDelegate ? users.find(row => row.id === forwardTo)?.name : undefined,
        context: {
          departmentId: requirement.departmentId,
          projectId: requirement.projectId,
          departmentHodId: requirement.departmentHodId,
          projectHeadId: requirement.projectHeadId,
          requestingManagerId: requirement.requestingManagerId,
          roleByUserId: Object.fromEntries(users.map(row => [row.id, row.role || ''])),
        },
      });

      onDone(
        result.status === 'REJECTED'
          ? 'Requirement rejected'
          : result.status === 'DRAFT'
            ? 'Sent back to the requester'
            : result.status === 'RECRUITER_ASSIGNMENT_PENDING'
              ? 'Approved — a recruiter can now be assigned'
              : result.stageLabel
                ? `Recorded; now with ${result.stageLabel}`
                : 'Decision recorded',
      );
      setRemarks('');
      setCondition('');
      setForwardTo('');
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
          <DialogTitle>{action} — {requirement.requirementNumber}</DialogTitle>
          <DialogDescription>
            {requirement.requestedQuantity} × {requirement.designation} · {requirement.departmentName}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {action === 'Send Back' && (
            <HrAlertNotice tone="amber" title="This clears the approvals so far">
              The requirement returns to the requester as a draft. When they resubmit, the chain starts
              again — so an earlier approval cannot survive a change to the quantity or the CTC.
            </HrAlertNotice>
          )}

          {action === 'Request Clarification' && (
            <HrAlertNotice tone="blue" title="The approval stays with you">
              Asking for clarification does not move the requirement on. It stays on your list until you
              approve or reject it.
            </HrAlertNotice>
          )}

          {needsDelegate && (
            <div>
              <Label className="text-xs">
                {action === 'Delegate' ? 'Delegate to *' : 'Forward to *'}
              </Label>
              <Select value={forwardTo} onValueChange={setForwardTo}>
                <SelectTrigger><SelectValue placeholder="Select a person" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {users.map(row => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                      {row.role ? ` · ${row.role}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                They take your place on this stage; your name stays on the trail as the person who delegated.
              </p>
            </div>
          )}

          {action === 'Approve With Condition' && (
            <div>
              <Label className="text-xs">Condition *</Label>
              <Textarea
                rows={2}
                value={condition}
                onChange={event => setCondition(event.target.value)}
                placeholder="e.g. Approved for 2 positions only; the third to be reviewed in October."
              />
            </div>
          )}

          <div>
            <Label className="text-xs">
              Remarks {needsRemarks ? '*' : '(optional)'}
            </Label>
            <Textarea rows={3} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={action === 'Reject' ? 'destructive' : 'default'}
            onClick={submit}
            disabled={
              saving ||
              (needsRemarks && !remarks.trim()) ||
              (needsDelegate && !forwardTo) ||
              (action === 'Approve With Condition' && !condition.trim())
            }
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
