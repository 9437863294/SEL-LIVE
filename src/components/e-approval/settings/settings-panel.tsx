'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  BellRing,
  Check,
  FileLock,
  Hash,
  Info,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Users,
  UserSearch,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  DEFAULT_E_APPROVAL_ESCALATION_LADDER,
  eApprovalAdHocAssigneeKinds,
  E_APPROVAL_AD_HOC_ASSIGNEE_KINDS,
  E_APPROVAL_ASSIGNEE_KIND_LABELS,
  E_APPROVAL_MATERIAL_FIELD_LABELS,
  eApprovalReference,
  type EApprovalEscalationRule,
  type EApprovalRestartPolicy,
  type EApprovalSettingsRecord,
} from '@/lib/e-approval';
import { runEApprovalEscalations, saveEApprovalSettings, type EApprovalServiceActor } from '@/lib/e-approval-service';
import {
  PolicyNote,
  PolicyNumberInput,
  PolicyRow,
  PolicySection,
  PolicySwitchRow,
} from './policy-controls';

const materialFieldOptions = Object.keys(E_APPROVAL_MATERIAL_FIELD_LABELS);

/**
 * The sections, in the order an admin is most likely to come looking for them.
 *
 * What approvers may do and who they may route to are the questions this page is opened for most;
 * numbering is set once and never touched again, so it goes last. Titles are the question the
 * section answers rather than the spec's name for it — "Editing after approval", not "Change
 * control" — because the person reading them is configuring an office, not reading the spec.
 */
const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'approver-powers', label: 'What approvers can do', icon: Users },
  { id: 'assignee-kinds', label: 'Who to send to', icon: UserSearch },
  { id: 'change-control', label: 'Editing after approval', icon: FileLock },
  { id: 'reminders', label: 'Deadlines & reminders', icon: AlarmClock },
  { id: 'recall-reverse', label: 'Undoing actions', icon: Undo2 },
  { id: 'numbering', label: 'Reference numbers', icon: Hash },
];

const ASSIGNEE_KIND_HELP: Record<string, string> = {
  User: 'A named colleague. Always available — somebody has to be nameable.',
  Department: 'A whole department. Anyone in it, or just its head, can act.',
  Project: 'A project. Its head, or whoever holds a named role on it.',
  Designation: 'A job title rather than a person, so it still works after a transfer.',
};

const RULE_KIND_LABELS: Record<EApprovalEscalationRule['kind'], string> = {
  Reminder: 'Remind the approver',
  Escalation: 'Escalate',
  'Notify Requester': 'Tell the requester',
};

/**
 * The values each tab holds — what "has this tab changed" compares.
 *
 * Per tab, because with the page split into tabs an edit can sit on a tab nobody is looking at: the
 * tab strip marks the ones with unsaved changes, and the save bar names them, so a change made two
 * tabs ago is not saved — or discarded — by surprise.
 *
 * Each value is read the way the module reads it rather than as stored. The field list and the
 * assignee kinds are compared as sets (ticking a field off and back on puts it at the end of the
 * array, which is not a change); a missing `returnViaRequester` is "on", as everywhere else. The
 * escalation ladder keeps its order, because its order is meaningful.
 */
const SECTION_VALUES: Record<string, (record: EApprovalSettingsRecord) => unknown> = {
  'approver-powers': (record) => [
    record.allowNestedVerification,
    record.maxVerificationDepth,
    record.allowReturnToAnyStep,
    record.returnViaRequester !== false,
    record.allowApproveAndComplete,
    record.skipSelfApprovalSteps,
  ],
  'assignee-kinds': (record) => eApprovalAdHocAssigneeKinds(record),
  'change-control': (record) => [
    [...(record.materialFields ?? [])].sort(),
    record.amountTolerancePct,
    record.restartOnMaterialChange,
  ],
  reminders: (record) => [record.defaultSlaHours, record.escalationLadder],
  'recall-reverse': (record) => [
    record.allowRecall,
    record.recallWindowMinutes,
    record.allowReverse,
    record.reverseWindowHours,
  ],
  numbering: (record) => record.numbering,
};

const sectionFingerprint = (record: EApprovalSettingsRecord | null, sectionId: string): string =>
  record ? JSON.stringify(SECTION_VALUES[sectionId](record)) : '';

/**
 * The Policies page (spec sections 6, 9, 22 and 24).
 *
 * Rebuilt for legibility. It had become a wall of checkboxes, each trailing the same small grey
 * prose, so the state of the module could not be read without reading every word — and a few
 * controls had drifted into the wrong card (the default deadline sat under change control; the
 * nesting depth floated in a different column from the switch it depends on). The rules now:
 *
 *   - **One row per setting**: the label and one sentence on the left, the control in a fixed
 *     right-hand column. The column of switches is the at-a-glance summary.
 *   - **Dependants live under their switch**, dimmed while it is off.
 *   - **Save appears when there is something to save**, with Discard beside it, so it is obvious
 *     whether the page matches what is stored.
 *   - **One tab per section**, so a visit about reminders shows reminders. Tabs with unsaved edits
 *     carry a dot and the save bar names them.
 *
 * Everything is still one settings record with one Save, because that is what it is.
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
  const [tab, setTab] = useState(SECTIONS[0].id);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  /*
   * Open on the tab named in the address, and keep the address in step with the tab.
   *
   * So a refresh, or a link someone pastes into a chat, lands on the same tab instead of always the
   * first. The hash rather than a query string, because changing it does not re-run the route.
   * Read in an effect, not while rendering: the server has no `window`, and reading it during render
   * would render a different tab on the server from the client.
   */
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (SECTIONS.some((section) => section.id === fromHash)) setTab(fromHash);
  }, []);

  const selectTab = (next: string) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  /** The tabs whose settings differ from what is stored. */
  const changedSections = useMemo(
    () =>
      SECTIONS.filter(
        (section) => sectionFingerprint(draft, section.id) !== sectionFingerprint(settings, section.id),
      ),
    [draft, settings],
  );
  const dirty = changedSections.length > 0;

  if (!draft) return null;

  // Read through the same helper the pickers use, so the switches shown here are the tabs that
  // actually appear — including the "empty means all four" reading every older record relies on.
  const effectiveAdHocKinds = eApprovalAdHocAssigneeKinds(draft);
  const locked = !canEdit;

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

  const selectedMaterialCount = materialFieldOptions.filter((field) => draft.materialFields.includes(field)).length;

  return (
    // One section at a time. The page was a single long scroll of six cards, which is a lot to take
    // in when the visit is usually about one of them; a tab strip shows the six topics up front and
    // keeps everything else out of the way. The draft is shared by every tab and saved once.
    <Tabs value={tab} onValueChange={selectTab} className="space-y-4">
      {/* The repo's tab strip scrolls sideways on its own when the tabs outgrow a phone, and keeps
          the active one in view — so all six can stay as labelled tabs at every width. */}
      <TabsList aria-label="Policy sections">
        {SECTIONS.map((section) => {
          const changed = changedSections.some((entry) => entry.id === section.id);
          return (
            <TabsTrigger key={section.id} value={section.id} className="gap-1.5 text-xs">
              <section.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {section.label}
              {changed && (
                <>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  <span className="sr-only">(unsaved changes)</span>
                </>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {locked && (
        <PolicyNote icon={Lock}>
          You can see these settings but not change them. Ask an administrator for edit access to E-Approval
          settings.
        </PolicyNote>
      )}

      <TabsContent value="approver-powers" className="mt-0">
        <PolicySection
          id="approver-powers"
          icon={Users}
          title="What approvers can do"
          description="Limits for the whole organisation. A workflow stage can switch any of these off for itself, but can't switch on one that is off here."
        >
          <PolicySwitchRow
            id="policy-nested-verification"
            label="Send for further verification"
            description="A verifier can pass the file to someone else to check. It always comes back up the same chain."
            checked={draft.allowNestedVerification}
            onCheckedChange={(checked) => setDraft({ ...draft, allowNestedVerification: checked })}
            disabled={locked}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="policy-max-depth" className="text-xs font-medium">
                How many levels deep
              </Label>
              <PolicyNumberInput
                id="policy-max-depth"
                min={1}
                max={10}
                value={draft.maxVerificationDepth}
                onChange={(value) => setDraft({ ...draft, maxVerificationDepth: Number(value) || 4 })}
                unit="levels"
                disabled={locked || !draft.allowNestedVerification}
              />
            </div>
          </PolicySwitchRow>

          <PolicySwitchRow
            id="policy-return-any"
            label="Return to any earlier step"
            description="When off, an approver can only send a file back to the requester, or to whoever sent it to them."
            checked={draft.allowReturnToAnyStep}
            onCheckedChange={(checked) => setDraft({ ...draft, allowReturnToAnyStep: checked })}
            disabled={locked}
          />

          <PolicySwitchRow
            id="policy-return-via-requester"
            label="Returns go through the requester"
            description="The requester corrects the file, then it carries on from the step the approver chose. When off, that step gets the file straight back — but the person there can't edit the proposal."
            checked={draft.returnViaRequester !== false}
            onCheckedChange={(checked) => setDraft({ ...draft, returnViaRequester: checked })}
            disabled={locked}
          />

          <PolicySwitchRow
            id="policy-approve-complete"
            label="Allow “Approve & complete”"
            description="Lets an approver finish the whole workflow early. Only offered on stages where the workflow also allows it."
            checked={draft.allowApproveAndComplete}
            onCheckedChange={(checked) => setDraft({ ...draft, allowApproveAndComplete: checked })}
            disabled={locked}
          />

          <PolicySwitchRow
            id="policy-skip-self"
            label="Sign off the requester's own stages automatically"
            description="If a stage lands on the person who raised the request, it is approved for them and the reason is recorded. A clarification asked of them still waits for an answer."
            checked={draft.skipSelfApprovalSteps}
            onCheckedChange={(checked) => setDraft({ ...draft, skipSelfApprovalSteps: checked })}
            disabled={locked}
          />
        </PolicySection>
      </TabsContent>

      <TabsContent value="assignee-kinds" className="mt-0">
        <PolicySection
          id="assignee-kinds"
          icon={UserSearch}
          title="Who an approval can be sent to"
          description="The choices shown when picking an approver — on the request form, and in the Forward, Delegate, Add approver and verification dialogs."
        >
          {E_APPROVAL_AD_HOC_ASSIGNEE_KINDS.map((kind) => {
            const always = kind === 'User';
            return (
              <PolicySwitchRow
                key={kind}
                id={`policy-kind-${kind}`}
                label={
                  <span className="inline-flex items-center gap-2">
                    {E_APPROVAL_ASSIGNEE_KIND_LABELS[kind] ?? kind}
                    {always && (
                      // A span, not <Badge>: Badge renders a div, which is invalid inside a <label>.
                      <span className="rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                        Always on
                      </span>
                    )}
                  </span>
                }
                description={ASSIGNEE_KIND_HELP[kind]}
                checked={always || effectiveAdHocKinds.includes(kind)}
                onCheckedChange={(next) =>
                  setDraft({
                    ...draft,
                    adHocAssigneeKinds: E_APPROVAL_AD_HOC_ASSIGNEE_KINDS.filter((candidate) =>
                      candidate === kind ? next : effectiveAdHocKinds.includes(candidate),
                    ),
                  })
                }
                // Person cannot be switched off: a form on which no approver can be named is not a
                // stricter policy, it is a form nobody can submit.
                disabled={locked || always}
              />
            );
          })}
          <div className="px-4 py-3 sm:px-5">
            <PolicyNote icon={Info}>
              Configured workflows and the approval matrix always keep all four, so switching one off here never
              breaks a workflow that already uses it.
            </PolicyNote>
          </div>
        </PolicySection>
      </TabsContent>

      <TabsContent value="change-control" className="mt-0">
        <PolicySection
          id="change-control"
          icon={FileLock}
          title="Editing after approval"
          description="Which edits cancel the approvals already given, and where approval starts again afterwards."
        >
          <PolicyRow
            label="Fields that cancel approvals"
            description={
              <>
                If one of these is changed after someone has approved, their approval no longer counts.{' '}
                <span className="font-medium text-foreground">
                  {selectedMaterialCount} of {materialFieldOptions.length} selected.
                </span>
              </>
            }
          >
            <div className="mt-3 flex flex-wrap gap-1.5">
              {materialFieldOptions.map((field) => {
                const on = draft.materialFields.includes(field);
                return (
                  <button
                    key={field}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => toggleMaterialField(field, !on)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      on
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {on ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
                    {E_APPROVAL_MATERIAL_FIELD_LABELS[field]}
                  </button>
                );
              })}
            </div>
            {!draft.materialFields.includes('amount') && (
              <PolicyNote tone="warning" icon={AlertTriangle} className="mt-3">
                With <span className="font-semibold">Amount</span> off, a figure can be raised after it was approved
                without cancelling anything. Leave it on unless you have a specific reason.
              </PolicyNote>
            )}
            {selectedMaterialCount === 0 && (
              // What actually happens, rather than what an empty list suggests: the loader reads an
              // empty list as "use the defaults", so saving with none ticked restores them.
              <PolicyNote tone="warning" icon={AlertTriangle} className="mt-3">
                With none selected, the recommended list is used when you save.
              </PolicyNote>
            )}
          </PolicyRow>

          <PolicyRow
            htmlFor="policy-tolerance"
            label="Small amount changes allowed"
            description="A change within this percentage is treated as a correction and doesn't cancel approvals. 0 means any change counts."
            control={
              <PolicyNumberInput
                id="policy-tolerance"
                min={0}
                step={0.01}
                value={draft.amountTolerancePct}
                onChange={(value) => setDraft({ ...draft, amountTolerancePct: Number(value) || 0 })}
                unit="%"
                disabled={locked}
              />
            }
          />

          <PolicyRow
            htmlFor="policy-restart"
            label="After a change, approval restarts from"
            description="Approvals the change cancelled always have to be given again — this decides who else sees the file."
            control={
              <Select
                value={draft.restartOnMaterialChange}
                onValueChange={(next) => setDraft({ ...draft, restartOnMaterialChange: next as EApprovalRestartPolicy })}
                disabled={locked}
              >
                <SelectTrigger id="policy-restart" className="h-9 w-full text-xs sm:w-[250px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="First Step">The first step — full re-approval</SelectItem>
                  <SelectItem value="Returning Step">The step that returned it</SelectItem>
                  <SelectItem value="Superseded Steps Only">Only the steps it cancelled</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </PolicySection>
      </TabsContent>

      <TabsContent value="reminders" className="mt-0">
        <PolicySection
          id="reminders"
          icon={AlarmClock}
          title="Deadlines & reminders"
          description="How long each step has, and what happens when it runs late. Time on hold, or waiting for a verification, isn't counted."
          actions={
            <>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setDraft({ ...draft, escalationLadder: DEFAULT_E_APPROVAL_ESCALATION_LADDER })}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Use recommended
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void runNow()}
                disabled={running}
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Run now
              </Button>
            </>
          }
        >
          <PolicyRow
            htmlFor="policy-default-sla"
            label="Default time per step"
            description="Used for any workflow stage that doesn't set its own deadline."
            control={
              <PolicyNumberInput
                id="policy-default-sla"
                min={1}
                value={draft.defaultSlaHours}
                onChange={(value) => setDraft({ ...draft, defaultSlaHours: Number(value) || 24 })}
                unit="hours"
                disabled={locked}
              />
            }
          />

          <PolicyRow
            label="Reminder schedule"
            description="Counted from the moment a step starts waiting. Each rule fires once per step."
          >
            {draft.escalationLadder.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {/* The loader reads an empty ladder as "use the default", so this is what saving
                    with no rules actually does — not "late approvals are never chased". */}
                No rules of your own. If you save with none, the recommended schedule is used.
              </div>
            ) : (
              <ol className="mt-3 space-y-0">
                {draft.escalationLadder.map((rule, index) => (
                  <li key={rule.id} className="flex gap-3">
                    <div className="flex flex-col items-center" aria-hidden>
                      {/* `mt-1.5` centres the 24px dot on the 36px input row it numbers. */}
                      <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      {index < draft.escalationLadder.length - 1 && <span className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pb-3">
                      <span className="text-xs text-muted-foreground">After</span>
                      <PolicyNumberInput
                        min={0}
                        value={rule.afterHours}
                        onChange={(value) => updateLadder(index, { afterHours: Number(value) || 0 })}
                        unit="hours"
                        disabled={locked}
                      />
                      <Select
                        value={rule.kind}
                        onValueChange={(next) => updateLadder(index, { kind: next as EApprovalEscalationRule['kind'] })}
                        disabled={locked}
                      >
                        <SelectTrigger className="h-9 w-[180px] text-xs" aria-label={`Rule ${index + 1} action`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(RULE_KIND_LABELS) as EApprovalEscalationRule['kind'][]).map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {RULE_KIND_LABELS[kind]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={rule.label ?? ''}
                        onChange={(event) => updateLadder(index, { label: event.target.value })}
                        placeholder="Name (optional)"
                        aria-label={`Rule ${index + 1} name`}
                        disabled={locked}
                        className="h-9 min-w-[140px] flex-1 text-xs sm:max-w-[220px]"
                      />
                      {rule.level && <span className="text-[11px] text-muted-foreground">{rule.level}</span>}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              escalationLadder: draft.escalationLadder.filter((_, position) => position !== index),
                            })
                          }
                          aria-label={`Remove rule ${index + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-8 gap-1.5 text-xs"
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
          </PolicyRow>

          <div className="px-4 py-3 sm:px-5">
            <PolicyNote icon={BellRing}>
              Approvals already notify people when they are assigned, returned, commented on, approved or rejected —
              these rules add the time-based reminders on top. To send them automatically, schedule{' '}
              <code className="whitespace-nowrap rounded bg-background px-1 py-px font-mono text-[11px]">
                /api/e-approval/escalations
              </code>{' '}
              to run regularly.
            </PolicyNote>
          </div>
        </PolicySection>
      </TabsContent>

      <TabsContent value="recall-reverse" className="mt-0">
        <PolicySection
          id="recall-reverse"
          icon={Undo2}
          title="Undoing actions"
          description="Undoing never deletes anything — the original action stays on the record, and the undo is added after it."
        >
          <PolicySwitchRow
            id="policy-recall"
            label="Allow recall"
            description="Whoever sent a verification, clarification, forward or delegation can take it back — as long as nobody has acted on it yet. No special permission needed."
            checked={draft.allowRecall}
            onCheckedChange={(checked) => setDraft({ ...draft, allowRecall: checked })}
            disabled={locked}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label htmlFor="policy-recall-window" className="text-xs font-medium">
                  Time limit
                </Label>
                <p className="text-[11px] text-muted-foreground">Keep it short — after a while, the file has been read.</p>
              </div>
              <PolicyNumberInput
                id="policy-recall-window"
                min={1}
                max={1440}
                value={draft.recallWindowMinutes}
                onChange={(value) => setDraft({ ...draft, recallWindowMinutes: Number(value) || 1 })}
                unit="minutes"
                disabled={locked || !draft.allowRecall}
              />
            </div>
          </PolicySwitchRow>

          <PolicySwitchRow
            id="policy-reverse"
            label="Allow reversal"
            description={
              <>
                Someone with the <span className="font-medium text-foreground">Reversals → Reverse Any</span> permission
                can undo a completed approval, verification, rejection or hold. Only the latest action can be undone;
                reversing a rejection reopens the request.
              </>
            }
            checked={draft.allowReverse}
            onCheckedChange={(checked) => setDraft({ ...draft, allowReverse: checked })}
            disabled={locked}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="policy-reverse-window" className="text-xs font-medium">
                Time limit
              </Label>
              <PolicyNumberInput
                id="policy-reverse-window"
                min={1}
                max={720}
                value={draft.reverseWindowHours}
                onChange={(value) => setDraft({ ...draft, reverseWindowHours: Number(value) || 1 })}
                unit="hours"
                disabled={locked || !draft.allowReverse}
              />
            </div>
          </PolicySwitchRow>
        </PolicySection>
      </TabsContent>

      <TabsContent value="numbering" className="mt-0">
        <PolicySection
          id="numbering"
          icon={Hash}
          title="Reference numbers"
          description="Each approval gets a number when it is submitted, counted separately for every financial year."
        >
          <div className="px-4 py-4 sm:px-5">
            {/* The preview leads, because it is the thing being designed — the inputs below are
                just how to get it. */}
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Example</p>
              <p className="mt-1 break-all font-mono text-lg font-semibold tracking-wide">
                {eApprovalReference(125, { settings: draft.numbering, departmentCode: 'FIN' })}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                The 125th approval from Finance this financial year
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:grid-cols-3 sm:px-5">
            <div>
              <Label htmlFor="policy-prefix" className="text-xs font-medium">
                Prefix
              </Label>
              <Input
                id="policy-prefix"
                value={draft.numbering.prefix}
                onChange={(event) =>
                  setDraft({ ...draft, numbering: { ...draft.numbering, prefix: event.target.value.toUpperCase() } })
                }
                disabled={locked}
                className="mt-1 h-9 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="policy-separator" className="text-xs font-medium">
                Separator
              </Label>
              <Input
                id="policy-separator"
                value={draft.numbering.separator}
                onChange={(event) =>
                  setDraft({ ...draft, numbering: { ...draft.numbering, separator: event.target.value } })
                }
                disabled={locked}
                className="mt-1 h-9 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="policy-digits" className="text-xs font-medium">
                Number of digits
              </Label>
              <Input
                id="policy-digits"
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
                disabled={locked}
                className="mt-1 h-9 text-sm tabular-nums"
              />
            </div>
          </div>

          <PolicyRow
            inline
            htmlFor="policy-dept-code"
            label="Include the department code"
            description="Adds the department's short code — FIN in the example — so the number shows where the request came from."
            control={
              <Switch
                id="policy-dept-code"
                checked={draft.numbering.includeDepartmentCode}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, numbering: { ...draft.numbering, includeDepartmentCode: checked } })
                }
                disabled={locked}
              />
            }
          />
        </PolicySection>
      </TabsContent>

      {/*
        The save bar only exists while there is something to save, and it names the tabs that have
        changes — split into tabs, an edit can sit on one the admin has since moved away from, and
        "Unsaved changes" alone would leave them hunting for it. Each name opens its tab. Outside
        the tab panels so it stays put whichever tab is open; above the phone's floating navigation.
      */}
      {canEdit && dirty && (
        <div className="sticky bottom-20 z-20 lg:bottom-4" role="region" aria-label="Unsaved changes">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                Unsaved changes
              </p>
              <p className="mt-0.5 pl-4 text-xs text-muted-foreground">
                In{' '}
                {changedSections.map((section, index) => (
                  <span key={section.id}>
                    {index > 0 && ', '}
                    <button
                      type="button"
                      onClick={() => selectTab(section.id)}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {section.label}
                    </button>
                  </span>
                ))}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-9 gap-1.5"
                onClick={() => setDraft(settings)}
                disabled={busy}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Discard
              </Button>
              <Button size="sm" className="h-9 gap-1.5" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </Tabs>
  );
}
