'use client';

import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCheck,
  CheckCircle2,
  CornerDownLeft,
  HandMetal,
  HelpCircle,
  Loader2,
  MessageSquarePlus,
  PauseCircle,
  PlayCircle,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  availableEApprovalActions,
  canActOnEApprovalStep,
  canAssignEApprovalStep,
  canTakeEApprovalOwnership,
  describeEApprovalAssignment,
  eApprovalReturnTargets,
  E_APPROVAL_ACTION_LABELS,
  isTerminalEApprovalStatus,
  primaryEApprovalSteps,
  VERIFICATION_OUTCOMES,
  type EApprovalActionKind,
  type EApprovalActor,
  type EApprovalAssignment,
  type EApprovalDetail,
  type EApprovalSettingsRecord,
  type EApprovalStep,
} from '@/lib/e-approval';
import {
  performEApprovalAction,
  submitEApproval,
  uploadEApprovalAttachment,
  type EApprovalServiceActor,
} from '@/lib/e-approval-service';
import { AssigneePicker } from './assignee-picker';
import { eApprovalDialogClass } from './shared';
import { formatEApprovalAmount, type EApprovalDirectory } from './hooks';

const actionIcons: Partial<Record<EApprovalActionKind, typeof CheckCircle2>> = {
  Approve: CheckCircle2,
  'Approve And Complete': CheckCheck,
  'Send For Verification': Search,
  Verify: ShieldCheck,
  'Request Clarification': HelpCircle,
  'Provide Clarification': MessageSquarePlus,
  Return: CornerDownLeft,
  Forward: ArrowUpRight,
  Delegate: Users,
  'Add Approver': UserPlus,
  Escalate: ArrowUpRight,
  Reject: XCircle,
  Hold: PauseCircle,
  Resume: PlayCircle,
  'Take Ownership': HandMetal,
  Assign: UserPlus,
  'Add Participant': UserPlus,
  Submit: Send,
  Resubmit: Send,
  Cancel: XCircle,
};

/** Which actions are destructive enough to want a red button. */
const destructive: EApprovalActionKind[] = ['Reject', 'Cancel'];
/** Which are the primary, expected action on the step. */
const primary: EApprovalActionKind[] = ['Approve', 'Verify', 'Provide Clarification', 'Submit', 'Resubmit'];

interface DialogConfig {
  kind: EApprovalActionKind;
  needsComment?: boolean;
  needsReason?: boolean;
  needsTargets?: 'single' | 'multiple';
  needsInstruction?: boolean;
  needsReturnTarget?: boolean;
  needsOutcome?: boolean;
  needsParticipants?: boolean;
  allowSla?: boolean;
  description: string;
}

const dialogs: Record<string, DialogConfig> = {
  Approve: { kind: 'Approve', needsComment: true, description: 'Approve this stage and send the file on.' },
  'Approve And Complete': {
    kind: 'Approve And Complete',
    needsComment: true,
    needsReason: false,
    description: 'Approve and close the workflow — every remaining approval step will be skipped.',
  },
  'Send For Verification': {
    kind: 'Send For Verification',
    needsTargets: 'multiple',
    needsInstruction: true,
    allowSla: true,
    description:
      'The file goes to the verifier and comes back to you automatically. Your own step stays with you — it is not transferred.',
  },
  Verify: {
    kind: 'Verify',
    needsOutcome: true,
    needsComment: true,
    description: 'Record your verification. The file returns automatically to whoever asked for it.',
  },
  'Request Clarification': {
    kind: 'Request Clarification',
    needsTargets: 'multiple',
    needsInstruction: true,
    allowSla: true,
    description: 'Ask a question. The answer comes straight back to you.',
  },
  'Provide Clarification': {
    kind: 'Provide Clarification',
    needsComment: true,
    description: 'Answer the question and send the file back.',
  },
  Return: {
    kind: 'Return',
    needsReturnTarget: true,
    needsReason: true,
    description:
      'Send the file back to an earlier step. Steps between it and you will run again in their original order.',
  },
  Forward: {
    kind: 'Forward',
    needsTargets: 'single',
    needsReason: true,
    description: 'Transfer this approval to somebody else. They become the approver for this step.',
  },
  Delegate: {
    kind: 'Delegate',
    needsTargets: 'single',
    needsReason: true,
    description: 'Let somebody else act in your place. You keep the step; they gain the authority to act on it.',
  },
  'Add Approver': {
    kind: 'Add Approver',
    needsTargets: 'multiple',
    needsInstruction: true,
    allowSla: true,
    description: 'Insert an extra approval step immediately after yours.',
  },
  Escalate: {
    kind: 'Escalate',
    needsTargets: 'single',
    needsReason: true,
    description: 'Hand the step to a senior authority. The SLA clock restarts for them.',
  },
  Reject: { kind: 'Reject', needsReason: true, description: 'Reject the request. This closes the approval.' },
  Hold: { kind: 'Hold', needsReason: true, description: 'Put the file on hold. The SLA clock stops until you resume.' },
  Resume: { kind: 'Resume', description: 'Take the file off hold and restart the clock.' },
  'Take Ownership': { kind: 'Take Ownership', description: 'Claim this department step so it is assigned to you.' },
  Assign: {
    kind: 'Assign',
    needsTargets: 'single',
    needsInstruction: true,
    description:
      'Hand this department file to a named member. It stays on the department’s record; they become the one responsible for it.',
  },
  'Add Participant': {
    kind: 'Add Participant',
    needsParticipants: true,
    description: 'Give somebody view and comment access to this approval.',
  },
  Cancel: { kind: 'Cancel', needsReason: true, description: 'Cancel your request. This closes the approval.' },
  Resubmit: {
    kind: 'Resubmit',
    needsComment: true,
    description:
      'Send the corrected request back into the workflow. If you changed the subject, proposal, amount or attachments, the approvals already given are superseded and the chain restarts.',
  },
  Submit: { kind: 'Submit', needsComment: true, description: 'Submit for approval.' },
};

/**
 * The action panel of spec section 9.
 *
 * Which buttons appear is decided by the engine (`availableEApprovalActions`) from the step's type
 * and its configured capabilities, not by this component and not by the actor's role — so the panel
 * cannot offer something the reducer will refuse, and cannot hide something the assignee is entitled
 * to do.
 */
export function ActionPanel({
  detail,
  engineActor,
  serviceActor,
  settings,
  directory,
  onDone,
}: {
  detail: EApprovalDetail;
  engineActor: EApprovalActor | null;
  serviceActor: EApprovalServiceActor | null;
  settings: EApprovalSettingsRecord | null;
  directory: EApprovalDirectory;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { request, steps } = detail;
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [instruction, setInstruction] = useState('');
  const [targets, setTargets] = useState<EApprovalAssignment[]>([]);
  const [returnTo, setReturnTo] = useState('');
  const [outcome, setOutcome] = useState<string>('Verified');
  const [slaHours, setSlaHours] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  /** The figure this approval will sanction if nobody changes it — the running total, or the amount requested if nothing has revised it yet. */
  const currentApprovedAmount = request.approvedAmount ?? request.amount;
  const showAmountField =
    (dialog?.kind === 'Approve' || dialog?.kind === 'Approve And Complete') && request.amount != null;

  const myActiveSteps = useMemo(
    () =>
      engineActor
        ? steps.filter((step) =>
            canActOnEApprovalStep(step, engineActor, {
              requesterId: request.requesterId,
              approvalTypeId: request.approvalTypeId,
            }),
          )
        : [],
    [steps, engineActor, request.requesterId, request.approvalTypeId],
  );

  const heldByMe = useMemo(
    () =>
      engineActor
        ? steps.filter(
            (step) =>
              step.status === 'On Hold' &&
              (step.assignment.userId === engineActor.userId || step.ownedByUserId === engineActor.userId),
          )
        : [],
    [steps, engineActor],
  );

  const claimable = useMemo(
    () => (engineActor ? steps.filter((step) => canTakeEApprovalOwnership(step, engineActor)) : []),
    [steps, engineActor],
  );

  /** Department steps this actor heads — assignable whether or not a member has already claimed one. */
  const assignable = useMemo(
    () => (engineActor ? steps.filter((step) => canAssignEApprovalStep(step, engineActor)) : []),
    [steps, engineActor],
  );
  const [assignStepId, setAssignStepId] = useState<string | null>(null);

  const activeStep: EApprovalStep | null =
    (stepId ? myActiveSteps.find((step) => step.id === stepId) : myActiveSteps[0]) ?? myActiveSteps[0] ?? null;

  const remainingAhead = activeStep
    ? primaryEApprovalSteps(steps).some(
        (candidate) => candidate.status === 'Pending' && candidate.sequence > activeStep.sequence,
      )
    : false;

  const stepActions: EApprovalActionKind[] = activeStep
    ? availableEApprovalActions(request, activeStep, { settings: settings ?? undefined, hasRemainingSteps: remainingAhead })
    : [];

  const isRequester = request.requesterId === serviceActor?.userId;
  const requesterActions: EApprovalActionKind[] = [];
  if (isRequester && request.status === 'Draft') requesterActions.push('Submit');
  if (isRequester && request.status === 'Returned') requesterActions.push('Resubmit');
  if (isRequester && !isTerminalEApprovalStatus(request.status) && request.status !== 'Draft') {
    requesterActions.push('Cancel');
  }

  const returnOptions = useMemo(
    () =>
      activeStep
        ? eApprovalReturnTargets(steps, activeStep, { allowReturnToAnyStep: settings?.allowReturnToAnyStep ?? true })
        : [],
    [activeStep, steps, settings?.allowReturnToAnyStep],
  );

  const openDialog = (kind: EApprovalActionKind, targetStepId?: string) => {
    const config = dialogs[kind];
    if (!config) return;
    setAssignStepId(targetStepId ?? null);
    setComment('');
    setReason('');
    setInstruction('');
    setTargets([]);
    setReturnTo('');
    setOutcome('Verified');
    setSlaHours('');
    // Defaults to whatever is already being sanctioned — the running total if an earlier approver
    // revised it, otherwise the amount requested — so leaving it untouched approves exactly that.
    setApprovedAmount(currentApprovedAmount != null ? String(currentApprovedAmount) : '');
    setFiles([]);
    setDialog(config);
  };

  const submit = async () => {
    if (!serviceActor || !dialog) return;
    setBusy(true);
    try {
      // Attachments first: a file that failed to upload must not leave a transition claiming it is
      // there, and an orphaned attachment on a transition that then failed is harmless.
      for (const file of files) {
        await uploadEApprovalAttachment(request.id, file, serviceActor, {
          stepId: activeStep?.id ?? null,
          stepName: activeStep?.name,
          description: `Added with ${E_APPROVAL_ACTION_LABELS[dialog.kind]}`,
        });
      }

      if (dialog.kind === 'Submit') {
        await submitEApproval(request.id, serviceActor, { comment: comment.trim() || undefined });
      } else {
        await performEApprovalAction(
          request.id,
          {
            kind: dialog.kind,
            // An Assign acts on the head's department step, which need not be one the head holds.
            stepId: dialog.kind === 'Assign' ? (assignStepId ?? undefined) : activeStep?.id,
            comment: comment.trim() || undefined,
            reason: reason.trim() || undefined,
            instruction: instruction.trim() || undefined,
            targets: dialog.needsTargets || dialog.kind === 'Add Approver' ? targets : undefined,
            returnTo: dialog.needsReturnTarget ? returnTo : undefined,
            outcome: dialog.needsOutcome ? outcome : undefined,
            slaHours: slaHours ? Number(slaHours) : undefined,
            approvedAmount: showAmountField && approvedAmount ? Number(approvedAmount) : undefined,
            participantUserIds: dialog.needsParticipants
              ? targets.map((target) => target.userId).filter(Boolean as unknown as (value: string | undefined) => value is string)
              : undefined,
          },
          serviceActor,
        );
      }
      toast({ title: `${E_APPROVAL_ACTION_LABELS[dialog.kind]} recorded` });
      setDialog(null);
      onDone();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: `Could not ${E_APPROVAL_ACTION_LABELS[dialog.kind].toLowerCase()}`,
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const canSubmitDialog = (() => {
    if (!dialog) return false;
    if (dialog.needsReason && !reason.trim()) return false;
    if (dialog.kind === 'Provide Clarification' && !comment.trim()) return false;
    if (dialog.needsReturnTarget && !returnTo) return false;
    if (dialog.needsTargets && !targets.length) return false;
    if (dialog.needsParticipants && !targets.some((target) => target.userId)) return false;
    if (showAmountField && !(Number(approvedAmount) > 0)) return false;
    return true;
  })();

  const nothingToDo =
    !stepActions.length && !requesterActions.length && !heldByMe.length && !claimable.length && !assignable.length;

  if (nothingToDo) return null;

  const renderButton = (kind: EApprovalActionKind) => {
    const Icon = actionIcons[kind] ?? CheckCircle2;
    return (
      <Button
        key={kind}
        type="button"
        size="sm"
        variant={destructive.includes(kind) ? 'destructive' : primary.includes(kind) ? 'default' : 'outline'}
        className="h-9 gap-1.5"
        onClick={() => openDialog(kind)}
      >
        <Icon className="h-4 w-4" />
        {E_APPROVAL_ACTION_LABELS[kind]}
      </Button>
    );
  };

  return (
    <>
      <Card className="border-sky-200 bg-sky-50/40">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
          <CardTitle className="text-sm">Actions</CardTitle>
          {myActiveSteps.length > 1 && (
            <div className="flex items-center gap-2">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Acting on</Label>
              <Select value={activeStep?.id ?? ''} onValueChange={setStepId}>
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue placeholder="Choose a step" />
                </SelectTrigger>
                <SelectContent>
                  {myActiveSteps.map((step) => (
                    <SelectItem key={step.id} value={step.id}>
                      {step.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 px-3 pb-3 sm:px-4">
          {stepActions.map(renderButton)}
          {heldByMe.length > 0 && !stepActions.includes('Resume') && renderButton('Resume')}
          {claimable.length > 0 && renderButton('Take Ownership')}
          {assignable.map((step) => (
            <Button
              key={`assign-${step.id}`}
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => openDialog('Assign', step.id)}
            >
              <UserPlus className="h-4 w-4" />
              {step.ownedByUserId ? 'Reassign' : 'Assign to'}
              {assignable.length > 1 && <span className="text-muted-foreground">· {step.name}</span>}
            </Button>
          ))}
          {requesterActions.map(renderButton)}
        </CardContent>
      </Card>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className={eApprovalDialogClass.content}>
          <DialogHeader className={eApprovalDialogClass.header}>
            <DialogTitle>{dialog ? E_APPROVAL_ACTION_LABELS[dialog.kind] : ''}</DialogTitle>
            <DialogDescription className="text-xs">{dialog?.description}</DialogDescription>
          </DialogHeader>

          {dialog && (
            <div className={eApprovalDialogClass.body}>
              {(() => {
                const shown =
                  dialog.kind === 'Assign' ? steps.find((step) => step.id === assignStepId) ?? null : activeStep;
                if (!shown || dialog.kind === 'Submit' || dialog.kind === 'Cancel' || dialog.kind === 'Resubmit') return null;
                return (
                  <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
                    <span className="text-muted-foreground">Step: </span>
                    <span className="font-medium">{shown.name}</span>
                    <span className="text-muted-foreground"> · {describeEApprovalAssignment(shown.assignment)}</span>
                    {shown.ownedByName && dialog.kind === 'Assign' && (
                      <span className="text-muted-foreground"> · currently with {shown.ownedByName}</span>
                    )}
                  </div>
                );
              })()}

              {showAmountField && (
                <div>
                  <Label className="text-xs">
                    Amount you are approving <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    step="0.01"
                    value={approvedAmount}
                    onChange={(event) => setApprovedAmount(event.target.value)}
                    className="mt-1 h-9"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Requested: {formatEApprovalAmount(request.amount)}
                    {request.approvedAmount != null && request.approvedAmount !== request.amount && (
                      <> · already sanctioned at {formatEApprovalAmount(request.approvedAmount)}</>
                    )}
                    . Leave as is to approve that amount, or change it to approve a different one.
                  </p>
                </div>
              )}

              {dialog.needsOutcome && (
                <div>
                  <Label className="text-xs">Verification result</Label>
                  <Select value={outcome} onValueChange={setOutcome}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VERIFICATION_OUTCOMES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {outcome === 'Not Verified' && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      The file still returns to whoever asked for the verification — they decide what happens next.
                    </p>
                  )}
                </div>
              )}

              {dialog.needsReturnTarget && (
                <div>
                  <Label className="text-xs">Return to</Label>
                  <Select value={returnTo} onValueChange={setReturnTo}>
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Choose a step" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REQUESTER">
                        Requester — {request.requesterName || 'the person who raised it'}
                      </SelectItem>
                      {returnOptions.map((step) => (
                        <SelectItem key={step.id} value={step.id}>
                          {step.name} — {describeEApprovalAssignment(step.assignment)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {dialog.needsTargets && (
                <AssigneePicker
                  directory={directory}
                  value={targets}
                  onChange={setTargets}
                  multiple={dialog.needsTargets === 'multiple'}
                  allowRequester={dialog.kind === 'Request Clarification'}
                  allowDepartment={dialog.kind !== 'Assign'}
                  allowRole={dialog.kind !== 'Assign'}
                  label={
                    dialog.kind === 'Send For Verification'
                      ? 'Verify with'
                      : dialog.kind === 'Request Clarification'
                        ? 'Ask'
                        : dialog.kind === 'Add Approver'
                          ? 'Add approver'
                          : dialog.kind === 'Assign'
                            ? 'Assign to'
                            : 'Send to'
                  }
                />
              )}

              {dialog.needsParticipants && (
                <AssigneePicker
                  directory={directory}
                  value={targets}
                  onChange={setTargets}
                  multiple
                  allowDepartment={false}
                  allowRole={false}
                  label="Participants"
                />
              )}

              {dialog.needsInstruction && (
                <div>
                  <Label className="text-xs">
                    {dialog.kind === 'Add Approver'
                      ? 'Note for the approver'
                      : dialog.kind === 'Assign'
                        ? 'Note for them (optional)'
                        : 'What should they check?'}
                  </Label>
                  <Textarea
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    rows={2}
                    className="mt-1 text-sm"
                    placeholder="Please verify whether the quoted price matches the purchase order."
                  />
                </div>
              )}

              {dialog.allowSla && (
                <div>
                  <Label className="text-xs">Due in (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={slaHours}
                    onChange={(event) => setSlaHours(event.target.value)}
                    placeholder={String(settings?.defaultSlaHours ?? 24)}
                    className="mt-1 h-9"
                  />
                </div>
              )}

              {dialog.needsReason && (
                <div>
                  <Label className="text-xs">
                    Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    className="mt-1 text-sm"
                    placeholder="Why?"
                  />
                </div>
              )}

              {dialog.needsComment && (
                <div>
                  <Label className="text-xs">
                    Comment{dialog.kind === 'Provide Clarification' && <span className="text-destructive"> *</span>}
                  </Label>
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    className="mt-1 text-sm"
                    placeholder="Optional note recorded against this action."
                  />
                </div>
              )}

              <div>
                <Label className="text-xs">Attach documents</Label>
                <Input
                  type="file"
                  multiple
                  className="mt-1 h-9 cursor-pointer text-xs"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
                {files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {files.map((file) => (
                      <Badge key={file.name} variant="secondary" className="text-[10px]">
                        {file.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {dialog.kind === 'Approve And Complete' && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                  Every remaining approval step will be marked skipped. Use this only where your authority covers the
                  whole chain.
                </p>
              )}

              {dialog.kind === 'Resubmit' && (
                <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800">
                  Edit the request first if it needs changing. On resubmission the system compares the subject, proposal,
                  amount, department, project and attachments against what the approvers saw.
                </p>
              )}
            </div>
          )}

          <DialogFooter className={eApprovalDialogClass.footer}>
            <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !canSubmitDialog}
              className={cn(dialog && destructive.includes(dialog.kind) && 'bg-destructive hover:bg-destructive/90')}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {dialog ? E_APPROVAL_ACTION_LABELS[dialog.kind] : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
