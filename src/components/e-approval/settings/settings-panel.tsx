'use client';

import { useEffect, useState } from 'react';
import { AlarmClock, BellRing, Hash, Loader2, Plus, Save, ShieldCheck, Trash2, Undo2, Users, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_E_APPROVAL_ESCALATION_LADDER,
  E_APPROVAL_MATERIAL_FIELD_LABELS,
  eApprovalReference,
  type EApprovalEscalationRule,
  type EApprovalRestartPolicy,
  type EApprovalSettingsRecord,
} from '@/lib/e-approval';
import { runEApprovalEscalations, saveEApprovalSettings, type EApprovalServiceActor } from '@/lib/e-approval-service';

const materialFieldOptions = Object.keys(E_APPROVAL_MATERIAL_FIELD_LABELS);

/**
 * Change control, SLA and numbering (spec sections 6, 22 and 24).
 *
 * The change-control block is the consequential one: it decides which edits invalidate approvals
 * already given. Turning a field off here means an approver's signature survives that field changing
 * underneath it, which is occasionally what an organisation wants and never something it should do by
 * accident — hence the explicit list rather than a single "strict mode" switch.
 */
export function EApprovalSettingsPanel({
  serviceActor,
  settings,
  canEdit,
  onSaved,
}: {
  serviceActor: EApprovalServiceActor | null;
  settings: EApprovalSettingsRecord | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<EApprovalSettingsRecord | null>(settings);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!draft) return null;

  const save = async () => {
    if (!serviceActor) return;
    setBusy(true);
    try {
      await saveEApprovalSettings(draft, serviceActor);
      toast({ title: 'Settings saved' });
      onSaved();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!serviceActor) return;
    setRunning(true);
    try {
      const result = await runEApprovalEscalations(serviceActor);
      toast({
        title: 'Reminders processed',
        description: `${result.requestsChecked} open approvals checked · ${result.notificationsSent} notifications sent · ${result.escalationsRaised} escalations raised.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not run reminders',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setRunning(false);
    }
  };

  const toggleMaterialField = (field: string, enabled: boolean) =>
    setDraft({
      ...draft,
      materialFields: enabled
        ? Array.from(new Set([...draft.materialFields, field]))
        : draft.materialFields.filter((entry) => entry !== field),
    });

  const updateLadder = (index: number, patch: Partial<EApprovalEscalationRule>) =>
    setDraft({
      ...draft,
      escalationLadder: draft.escalationLadder.map((rule, position) =>
        position === index ? { ...rule, ...patch } : rule,
      ),
    });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <ShieldCheck className="h-4 w-4" /> Change Control
          </CardTitle>
          <CardDescription className="text-xs">
            Which edits supersede the approvals already given, and where the chain restarts afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 sm:px-4">
          <div>
            <Label className="text-xs">Fields whose change invalidates existing approvals</Label>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
              {materialFieldOptions.map((field) => (
                <label key={field} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={draft.materialFields.includes(field)}
                    onCheckedChange={(checked) => toggleMaterialField(field, checked === true)}
                    disabled={!canEdit}
                  />
                  {E_APPROVAL_MATERIAL_FIELD_LABELS[field]}
                </label>
              ))}
            </div>
            {!draft.materialFields.includes('amount') && (
              <p className="mt-1 text-[11px] text-rose-700">
                With Amount unchecked, a figure can be raised after approval without superseding anything. Leave it on
                unless you have a specific reason.
              </p>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Amount tolerance (%)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={draft.amountTolerancePct}
                onChange={(event) => setDraft({ ...draft, amountTolerancePct: Number(event.target.value) || 0 })}
                disabled={!canEdit}
                className="mt-1 h-8 text-sm"
              />
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                A change within this is treated as a correction. 0 means any change supersedes.
              </p>
            </div>
            <div>
              <Label className="text-xs">Restart from</Label>
              <Select
                value={draft.restartOnMaterialChange}
                onValueChange={(next) =>
                  setDraft({ ...draft, restartOnMaterialChange: next as EApprovalRestartPolicy })
                }
                disabled={!canEdit}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="First Step">The first step — full re-approval</SelectItem>
                  <SelectItem value="Returning Step">The step that returned it</SelectItem>
                  <SelectItem value="Superseded Steps Only">Only the superseded steps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Default SLA per step (hours)</Label>
              <Input
                type="number"
                min={1}
                value={draft.defaultSlaHours}
                onChange={(event) => setDraft({ ...draft, defaultSlaHours: Number(event.target.value) || 24 })}
                disabled={!canEdit}
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Users className="h-4 w-4" /> What approvers may do
          </CardTitle>
          <CardDescription className="text-xs">
            Organisation-wide ceilings. A workflow stage can still switch any of these off for itself —
            it can never switch one on that is off here.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-4">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="flex items-start gap-1.5 text-xs">
              <Checkbox
                checked={draft.allowNestedVerification}
                onCheckedChange={(checked) => setDraft({ ...draft, allowNestedVerification: checked === true })}
                disabled={!canEdit}
                className="mt-0.5"
              />
              <span>
                Allow nested verification
                <span className="block text-[11px] text-muted-foreground">
                  A verifier can send for further verification, which returns down the chain.
                </span>
              </span>
            </label>
            <div>
              <Label className="text-xs">Maximum nesting depth</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={draft.maxVerificationDepth}
                onChange={(event) => setDraft({ ...draft, maxVerificationDepth: Number(event.target.value) || 4 })}
                disabled={!canEdit || !draft.allowNestedVerification}
                className="mt-1 h-8 w-24 text-sm"
              />
            </div>
            <label className="flex items-start gap-1.5 text-xs">
              <Checkbox
                checked={draft.allowReturnToAnyStep}
                onCheckedChange={(checked) => setDraft({ ...draft, allowReturnToAnyStep: checked === true })}
                disabled={!canEdit}
                className="mt-0.5"
              />
              <span>
                Allow return to any earlier step
                <span className="block text-[11px] text-muted-foreground">
                  Off means an approver can only return to the requester or to whoever sent them the file.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-1.5 text-xs">
              <Checkbox
                checked={draft.allowApproveAndComplete}
                onCheckedChange={(checked) => setDraft({ ...draft, allowApproveAndComplete: checked === true })}
                disabled={!canEdit}
                className="mt-0.5"
              />
              <span>
                Allow &quot;approve &amp; complete&quot;
                <span className="block text-[11px] text-muted-foreground">
                  Still only offered on stages where the workflow enables it.
                </span>
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Undo2 className="h-4 w-4" /> Recall &amp; Reverse
          </CardTitle>
          <CardDescription className="text-xs">
            Taking an action back. Neither power deletes anything — the original action stays on the
            record and the undo is appended after it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 sm:px-4">
          <div className="rounded-lg border p-2.5">
            <label className="flex items-start gap-1.5 text-xs">
              <Checkbox
                checked={draft.allowRecall}
                onCheckedChange={(checked) => setDraft({ ...draft, allowRecall: checked === true })}
                disabled={!canEdit}
                className="mt-0.5"
              />
              <span>
                Allow recall
                <span className="block text-[11px] text-muted-foreground">
                  The person who sent a verification, clarification, forward, delegation or escalation can
                  take it back — but only while nobody has acted on it yet. No permission is needed: it is
                  their own dispatch, and the window is the control.
                </span>
              </span>
            </label>
            <div className="mt-2 flex items-end gap-2 pl-6">
              <div>
                <Label className="text-xs">Window (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.recallWindowMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, recallWindowMinutes: Number(event.target.value) || 1 })
                  }
                  disabled={!canEdit || !draft.allowRecall}
                  className="mt-1 h-8 w-24 text-sm"
                />
              </div>
              <p className="pb-1 text-[11px] text-muted-foreground">
                Keep it short. A verifier who has held a file for two hours has read it, and pretending
                the request never happened misrepresents the record.
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-2.5">
            <label className="flex items-start gap-1.5 text-xs">
              <Checkbox
                checked={draft.allowReverse}
                onCheckedChange={(checked) => setDraft({ ...draft, allowReverse: checked === true })}
                disabled={!canEdit}
                className="mt-0.5"
              />
              <span>
                Allow reversal
                <span className="block text-[11px] text-muted-foreground">
                  A completed action — an approval, a verification, a rejection, a hold — can be undone by
                  somebody holding <span className="font-medium">Reversals → Reverse Any</span>. Reversing a
                  rejection reopens the request.
                </span>
              </span>
            </label>
            <div className="mt-2 flex items-end gap-2 pl-6">
              <div>
                <Label className="text-xs">Window (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={draft.reverseWindowHours}
                  onChange={(event) =>
                    setDraft({ ...draft, reverseWindowHours: Number(event.target.value) || 1 })
                  }
                  disabled={!canEdit || !draft.allowReverse}
                  className="mt-1 h-8 w-24 text-sm"
                />
              </div>
              <p className="pb-1 text-[11px] text-muted-foreground">
                Only the most recent action can be reversed; to undo two, undo them in order.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <AlarmClock className="h-4 w-4" /> Reminders &amp; Escalation
            </CardTitle>
            <CardDescription className="text-xs">
              Measured from when a step became active, excluding time it spent on hold or waiting on a verification.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() =>
                  setDraft({ ...draft, escalationLadder: DEFAULT_E_APPROVAL_ESCALATION_LADDER })
                }
              >
                Reset to default
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void runNow()} disabled={running}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Run now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3 sm:px-4">
          {draft.escalationLadder.map((rule, index) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Input
                value={rule.label ?? ''}
                onChange={(event) => updateLadder(index, { label: event.target.value })}
                placeholder="Label"
                disabled={!canEdit}
                className="h-8 max-w-[200px] text-xs"
              />
              <div className="flex items-center gap-1">
                <Label className="text-[10px] uppercase text-muted-foreground">After</Label>
                <Input
                  type="number"
                  min={0}
                  value={rule.afterHours}
                  onChange={(event) => updateLadder(index, { afterHours: Number(event.target.value) || 0 })}
                  disabled={!canEdit}
                  className="h-8 w-20 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">h</span>
              </div>
              <Select
                value={rule.kind}
                onValueChange={(next) => updateLadder(index, { kind: next as EApprovalEscalationRule['kind'] })}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Reminder">Remind the approver</SelectItem>
                  <SelectItem value="Escalation">Escalate</SelectItem>
                  <SelectItem value="Notify Requester">Notify the requester</SelectItem>
                </SelectContent>
              </Select>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 w-7 p-0 text-destructive"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      escalationLadder: draft.escalationLadder.filter((_, position) => position !== index),
                    })
                  }
                  aria-label="Remove rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() =>
                setDraft({
                  ...draft,
                  escalationLadder: [
                    ...draft.escalationLadder,
                    { id: `rule-${Date.now()}`, afterHours: 24, kind: 'Reminder', label: 'Reminder' },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add rule
            </Button>
          )}
          <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Notifications are delivered through the central notification system, so approvals appear in the same bell as
            everything else. Assignment, verification, return, comment, mention, approval and rejection events notify
            automatically; the rules above add the time-based reminders on top. Schedule{' '}
            <code className="rounded bg-background px-1">/api/e-approval/escalations</code> to run them unattended.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Hash className="h-4 w-4" /> Numbering
          </CardTitle>
          <CardDescription className="text-xs">
            Reference numbers are allocated on submission, inside a transaction, per financial year.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-3 pb-3 sm:grid-cols-4 sm:px-4">
          <div>
            <Label className="text-xs">Prefix</Label>
            <Input
              value={draft.numbering.prefix}
              onChange={(event) =>
                setDraft({ ...draft, numbering: { ...draft.numbering, prefix: event.target.value.toUpperCase() } })
              }
              disabled={!canEdit}
              className="mt-1 h-8 font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Separator</Label>
            <Input
              value={draft.numbering.separator}
              onChange={(event) =>
                setDraft({ ...draft, numbering: { ...draft.numbering, separator: event.target.value } })
              }
              disabled={!canEdit}
              className="mt-1 h-8 font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Digits</Label>
            <Input
              type="number"
              min={3}
              max={10}
              value={draft.numbering.sequenceWidth}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  numbering: { ...draft.numbering, sequenceWidth: Number(event.target.value) || 5 },
                })
              }
              disabled={!canEdit}
              className="mt-1 h-8 text-sm"
            />
          </div>
          <label className="flex items-end gap-1.5 pb-1.5 text-xs">
            <Checkbox
              checked={draft.numbering.includeDepartmentCode}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  numbering: { ...draft.numbering, includeDepartmentCode: checked === true },
                })
              }
              disabled={!canEdit}
            />
            Include department code
          </label>
          <div className="sm:col-span-4">
            <Badge variant="outline" className="font-mono text-[11px]">
              {eApprovalReference(125, { settings: draft.numbering, departmentCode: 'FIN' })}
            </Badge>
            <span className="ml-2 text-[11px] text-muted-foreground">Example for the Finance department</span>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="sticky bottom-0 flex justify-end rounded-lg border bg-background/95 p-2.5 shadow-lg backdrop-blur">
          <Button className="gap-1.5" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
          </Button>
        </div>
      )}
    </div>
  );
}
