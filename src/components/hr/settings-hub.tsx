'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_HR_APPROVAL_RULES,
  EMPLOYMENT_TYPES,
  HR_APPROVAL_STAGE_LABELS,
  INTERVIEW_ROUNDS,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_TYPES,
  type HrApprovalRule,
  type HrSettings,
} from '@/lib/hr-requirement';
import { HrControlError, saveHrSettings } from '@/lib/hr-requirement-service';
import { HrAccessDenied, HrAlertNotice, HrLoader, HrPageHeader, HrSection } from './hr-ui';
import { useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * HR settings, spec section 58.
 *
 * Everything the module's behaviour depends on is configurable from here rather than hard-coded:
 * the masters, the approval matrix of sections 12–13, the CTC tolerance that decides when a
 * compensation approval is raised, the SLA targets and escalation ladder, the document checklist and
 * the notification events.
 *
 * Saves are per-section rather than one giant form. A settings screen that writes every section on
 * every save turns an SLA tweak into a rewrite of the approval matrix, which is how a careful edit
 * ends up clobbering somebody else's.
 */

type SectionKey = keyof HrSettings;

export default function HrSettingsHub() {
  const { toast } = useToast();
  const { settings, actor, loading, refreshSettings } = useHrConfig();
  const permissions = useHrPermissions();

  const [draft, setDraft] = useState<HrSettings>(settings);
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const canEdit = permissions.can('Edit', 'Settings');

  const save = async (section: SectionKey, label: string) => {
    if (!actor) return;
    setSavingSection(section);
    try {
      await saveHrSettings(actor.organizationId, { [section]: draft[section] } as Partial<HrSettings>, actor);
      await refreshSettings();
      toast({ title: `${label} saved` });
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSavingSection(null);
    }
  };

  const SaveButton = ({ section, label }: { section: SectionKey; label: string }) =>
    canEdit ? (
      <Button size="sm" onClick={() => save(section, label)} disabled={savingSection === section} className="gap-1.5">
        {savingSection === section ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
      </Button>
    ) : null;

  /** Comma-separated text ↔ string[], for the master lists. */
  const listField = (value: string[]) => value.join(', ');
  const parseList = (value: string) =>
    value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);

  if (loading) return <HrLoader label="Loading settings…" />;
  if (!permissions.can('View', 'Settings')) return <HrAccessDenied what="HR settings" />;

  return (
    <div>
      <HrPageHeader
        title="HR Settings"
        description="Spec section 58 — masters, approval matrix, CTC rules, SLA and escalation, checklists and notifications."
      />

      {!canEdit && (
        <div className="mb-3">
          <HrAlertNotice tone="blue" title="Read only">
            You can view the configuration but not change it.
          </HrAlertNotice>
        </div>
      )}

      <Tabs defaultValue="general">
        <TabsList className="mb-3 w-full justify-start overflow-x-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="masters">Masters</TabsTrigger>
          <TabsTrigger value="approvals">Approval matrix</TabsTrigger>
          <TabsTrigger value="compensation">CTC rules</TabsTrigger>
          <TabsTrigger value="sla">SLA &amp; escalation</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* ── General ── */}
        <TabsContent value="general">
          <HrSection
            title="General controls"
            description="How strict the module is about justification, sanctioned strength and duplicates."
            actions={<SaveButton section="general" label="General settings" />}
          >
            <div className="space-y-3">
              {(
                [
                  ['requireJustificationForNewPositions', 'Require a business justification for new positions', 'Spec section 10.'],
                  ['blockAboveSanctionedStrength', 'Block requirements above sanctioned strength', 'Off by default — they route to Finance and management instead of being refused.'],
                  ['warnOnDuplicateRequirement', 'Warn about duplicate requirements', 'Advisory only; the requester can still proceed (spec section 11).'],
                  ['allowEmergencyRequirements', 'Allow emergency requirements', ''],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{label}</span>
                    {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
                  </span>
                  <Switch
                    checked={Boolean(draft.general[key])}
                    disabled={!canEdit}
                    onCheckedChange={value =>
                      setDraft(prev => ({ ...prev, general: { ...prev.general, [key]: value } }))
                    }
                  />
                </label>
              ))}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label className="text-xs">Default target closure (days)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={draft.general.defaultTargetClosureDays}
                    onChange={event =>
                      setDraft(prev => ({
                        ...prev,
                        general: { ...prev.general, defaultTargetClosureDays: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Employee code prefix</Label>
                  <Input
                    disabled={!canEdit}
                    value={draft.general.employeeCodePrefix}
                    onChange={event =>
                      setDraft(prev => ({ ...prev, general: { ...prev.general, employeeCodePrefix: event.target.value } }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Employee code starts at</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={draft.general.employeeCodeStart}
                    onChange={event =>
                      setDraft(prev => ({
                        ...prev,
                        general: { ...prev.general, employeeCodeStart: Number(event.target.value) || 1 },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Employee code digits</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={draft.general.employeeCodeWidth}
                    onChange={event =>
                      setDraft(prev => ({
                        ...prev,
                        general: { ...prev.general, employeeCodeWidth: Number(event.target.value) || 5 },
                      }))
                    }
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Next code: {draft.general.employeeCodePrefix}
                    {String(draft.general.employeeCodeStart).padStart(draft.general.employeeCodeWidth, '0')}
                  </p>
                </div>
              </div>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Masters ── */}
        <TabsContent value="masters">
          <HrSection
            title="Masters"
            description="Grades, designations, qualifications, skills and talent-pool categories."
            actions={<SaveButton section="masters" label="Masters" />}
          >
            {/*
              Stated up front because it is the first thing someone looks for here and does not find.
              Department and project are app-wide records shared with Payroll, Attendance and the
              project modules; a second copy kept in HR would drift from them.
            */}
            <div className="mb-4">
              <HrAlertNotice tone="blue" title="Department, project and location are global">
                HR reads them from the app-wide records, so they stay the same everywhere. Maintain
                them in{' '}
                <Link href="/settings/department" className="font-semibold underline">
                  Settings → Manage Department
                </Link>{' '}
                and{' '}
                <Link href="/settings/project" className="font-semibold underline">
                  Settings → Manage Project
                </Link>
                . A requirement&apos;s location follows the project it is raised against.
              </HrAlertNotice>
            </div>

            <div className="space-y-3">
              {(
                [
                  ['grades', 'Grades', 'e.g. M1, M2, M3, E1, S1'],
                  ['seniorManagementGrades', 'Senior management grades', 'These route through the senior-management approval chain (spec section 13).'],
                  ['designations', 'Designations', ''],
                  ['qualifications', 'Qualifications', ''],
                  ['skills', 'Skills', 'Offered as suggestions on the requirement wizard.'],
                  ['talentPoolCategories', 'Talent pool categories', ''],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Textarea
                    rows={2}
                    disabled={!canEdit}
                    value={listField(draft.masters[key] as string[])}
                    onChange={event =>
                      setDraft(prev => ({ ...prev, masters: { ...prev.masters, [key]: parseList(event.target.value) } }))
                    }
                    placeholder="Comma separated"
                  />
                  {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
                </div>
              ))}

              {/* CTC bands per grade — what section 9's band check reads. */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs">CTC bands by grade</Label>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() =>
                        setDraft(prev => ({
                          ...prev,
                          masters: { ...prev.masters, ctcBands: [...prev.masters.ctcBands, { grade: '', min: 0, max: 0 }] },
                        }))
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> Add band
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {draft.masters.ctcBands.map((band, index) => (
                    <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <Input
                        disabled={!canEdit}
                        placeholder="Grade"
                        value={band.grade}
                        onChange={event =>
                          setDraft(prev => {
                            const bands = [...prev.masters.ctcBands];
                            bands[index] = { ...bands[index], grade: event.target.value };
                            return { ...prev, masters: { ...prev.masters, ctcBands: bands } };
                          })
                        }
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEdit}
                        placeholder="Minimum"
                        value={band.min || ''}
                        onChange={event =>
                          setDraft(prev => {
                            const bands = [...prev.masters.ctcBands];
                            bands[index] = { ...bands[index], min: Number(event.target.value) || 0 };
                            return { ...prev, masters: { ...prev.masters, ctcBands: bands } };
                          })
                        }
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEdit}
                        placeholder="Maximum"
                        value={band.max || ''}
                        onChange={event =>
                          setDraft(prev => {
                            const bands = [...prev.masters.ctcBands];
                            bands[index] = { ...bands[index], max: Number(event.target.value) || 0 };
                            return { ...prev, masters: { ...prev.masters, ctcBands: bands } };
                          })
                        }
                      />
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-rose-700"
                          onClick={() =>
                            setDraft(prev => ({
                              ...prev,
                              masters: { ...prev.masters, ctcBands: prev.masters.ctcBands.filter((_, i) => i !== index) },
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {draft.masters.ctcBands.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      With no bands configured, no requirement or offer is checked against a salary ceiling.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Approval matrix ── */}
        <TabsContent value="approvals">
          <HrSection
            title="Approval matrix"
            description="Spec sections 12 and 13. The most specific matching rule wins, so order does not decide the outcome."
            actions={<SaveButton section="approvals" label="Approval matrix" />}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Default stage turnaround (business hours)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={draft.approvals.defaultStageTatHours}
                    onChange={event =>
                      setDraft(prev => ({
                        ...prev,
                        approvals: { ...prev.approvals, defaultStageTatHours: Number(event.target.value) || 24 },
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="mb-3 space-y-2">
              {(
                [
                  ['skipSelfApproval', 'Skip a stage when its only approver raised the request'],
                  ['allowDelegation', 'Allow an approver to delegate their stage'],
                  ['allowForward', 'Allow an approver to forward for advice'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="text-sm text-slate-800">{label}</span>
                  <Switch
                    checked={Boolean(draft.approvals[key])}
                    disabled={!canEdit}
                    onCheckedChange={value => setDraft(prev => ({ ...prev, approvals: { ...prev.approvals, [key]: value } }))}
                  />
                </label>
              ))}
            </div>

            <RuleEditor
              rules={draft.approvals.rules || []}
              canEdit={canEdit}
              onChange={rules => setDraft(prev => ({ ...prev, approvals: { ...prev.approvals, rules } }))}
            />

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-700">Fallback chain</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Used when no rule matches, so a submitted requirement is never left with nobody to approve it:{' '}
                {(draft.approvals.fallbackStages || [])
                  .map(stage => HR_APPROVAL_STAGE_LABELS[stage.key] || stage.key)
                  .join(' → ') || 'not configured'}
                .
              </p>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Compensation ── */}
        <TabsContent value="compensation">
          <HrSection
            title="CTC approval rules"
            description="Spec sections 9 and 28 — when a proposal has to be approved before an offer can be released."
            actions={<SaveButton section="compensation" label="CTC rules" />}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Tolerance above the band (%)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={draft.compensation.tolerancePercent}
                  onChange={event =>
                    setDraft(prev => ({
                      ...prev,
                      compensation: { ...prev.compensation, tolerancePercent: Number(event.target.value) || 0 },
                    }))
                  }
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  0 means any rupee above the band routes a compensation approval. Raise it to give recruiters a
                  negotiating margin.
                </p>
              </div>
            </div>

            <label className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">Also require approval below the band</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Off by default — underpaying against the band is flagged for HR to see, not blocked.
                </span>
              </span>
              <Switch
                checked={draft.compensation.requireApprovalForBelowBand}
                disabled={!canEdit}
                onCheckedChange={value =>
                  setDraft(prev => ({ ...prev, compensation: { ...prev.compensation, requireApprovalForBelowBand: value } }))
                }
              />
            </label>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-700">Compensation approval chain</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {(draft.compensation.approvalStages || [])
                  .map(stage => HR_APPROVAL_STAGE_LABELS[stage.key] || stage.key)
                  .join(' → ') || 'not configured'}
              </p>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── SLA & escalation ── */}
        <TabsContent value="sla">
          <HrSection
            title="SLA targets"
            description="Spec section 40 — configured, never hard-coded."
            actions={<SaveButton section="sla" label="SLA settings" />}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {REQUIREMENT_PRIORITIES.map(priority => (
                <div key={priority}>
                  <Label className="text-xs">{priority} (days)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!canEdit}
                    value={draft.sla.targets[priority]}
                    onChange={event =>
                      setDraft(prev => ({
                        ...prev,
                        sla: {
                          ...prev.sla,
                          targets: { ...prev.sla.targets, [priority]: Number(event.target.value) || 1 },
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">Pause the SLA clock while on hold</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Spec section 42.</span>
                </span>
                <Switch
                  checked={draft.sla.pauseOnHold}
                  disabled={!canEdit}
                  onCheckedChange={value => setDraft(prev => ({ ...prev, sla: { ...prev.sla, pauseOnHold: value } }))}
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className="text-sm font-medium text-slate-800">Escalations enabled</span>
                <Switch
                  checked={draft.sla.escalationEnabled}
                  disabled={!canEdit}
                  onCheckedChange={value => setDraft(prev => ({ ...prev, sla: { ...prev.sla, escalationEnabled: value } }))}
                />
              </label>
            </div>

            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs">Escalation ladder (spec section 41)</Label>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      setDraft(prev => ({
                        ...prev,
                        sla: {
                          ...prev.sla,
                          escalationLadder: [...prev.sla.escalationLadder, { atPercent: 100, notify: ['HR_HEAD'] }],
                        },
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add level
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {draft.sla.escalationLadder.map((level, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr_auto]">
                    <Input
                      type="number"
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={level.atPercent}
                      onChange={event =>
                        setDraft(prev => {
                          const ladder = [...prev.sla.escalationLadder];
                          ladder[index] = { ...ladder[index], atPercent: Number(event.target.value) || 0 };
                          return { ...prev, sla: { ...prev.sla, escalationLadder: ladder } };
                        })
                      }
                    />
                    <Input
                      disabled={!canEdit}
                      value={level.notify.join(', ')}
                      placeholder="RECRUITER, HR_MANAGER, HR_HEAD, DEPARTMENT_HOD, DIRECTOR"
                      onChange={event =>
                        setDraft(prev => {
                          const ladder = [...prev.sla.escalationLadder];
                          ladder[index] = {
                            ...ladder[index],
                            notify: parseList(event.target.value.toUpperCase()) as typeof level.notify,
                          };
                          return { ...prev, sla: { ...prev.sla, escalationLadder: ladder } };
                        })
                      }
                    />
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-rose-700"
                        onClick={() =>
                          setDraft(prev => ({
                            ...prev,
                            sla: { ...prev.sla, escalationLadder: prev.sla.escalationLadder.filter((_, i) => i !== index) },
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Percentage of SLA consumed, and who to notify. Each level fires once per requirement.
              </p>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Offers ── */}
        <TabsContent value="offers">
          <HrSection
            title="Offer settings"
            description="Spec sections 29 and 30."
            actions={<SaveButton section="offers" label="Offer settings" />}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Default validity (days)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={draft.offers.defaultValidityDays}
                  onChange={event =>
                    setDraft(prev => ({
                      ...prev,
                      offers: { ...prev.offers, defaultValidityDays: Number(event.target.value) || 7 },
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Candidate portal link validity (days)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={draft.offers.portalTokenValidityDays}
                  onChange={event =>
                    setDraft(prev => ({
                      ...prev,
                      offers: { ...prev.offers, portalTokenValidityDays: Number(event.target.value) || 15 },
                    }))
                  }
                />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {(
                [
                  ['requireOfferApproval', 'Offers need approval before they can be sent'],
                  ['enableCandidatePortal', 'Give candidates a secure link to accept online'],
                  ['requireSignedCopy', 'Require a signed copy before recording an acceptance'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="text-sm text-slate-800">{label}</span>
                  <Switch
                    checked={Boolean(draft.offers[key])}
                    disabled={!canEdit}
                    onCheckedChange={value => setDraft(prev => ({ ...prev, offers: { ...prev.offers, [key]: value } }))}
                  />
                </label>
              ))}
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Documents ── */}
        <TabsContent value="documents">
          <HrSection
            title="Pre-joining document checklist"
            description="Spec sections 31 to 33."
            actions={<SaveButton section="documents" label="Document checklist" />}
          >
            <label className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">Block joining while mandatory documents are outstanding</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Off by default — HR can proceed and the gaps stay flagged against the employee.
                </span>
              </span>
              <Switch
                checked={draft.documents.blockJoiningOnPendingDocuments}
                disabled={!canEdit}
                onCheckedChange={value =>
                  setDraft(prev => ({ ...prev, documents: { ...prev.documents, blockJoiningOnPendingDocuments: value } }))
                }
              />
            </label>

            <div className="mb-3">
              <Label className="text-xs">Reminder days before joining</Label>
              <Input
                disabled={!canEdit}
                value={draft.documents.reminderDays.join(', ')}
                onChange={event =>
                  setDraft(prev => ({
                    ...prev,
                    documents: {
                      ...prev.documents,
                      reminderDays: parseList(event.target.value)
                        .map(Number)
                        .filter(value => Number.isFinite(value)),
                    },
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                T-minus offsets; 0 is the joining day itself.
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs">Checklist</Label>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      setDraft(prev => ({
                        ...prev,
                        documents: {
                          ...prev.documents,
                          checklist: [...prev.documents.checklist, { documentType: '', mandatory: true }],
                        },
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add document
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {draft.documents.checklist.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto]">
                    <Input
                      disabled={!canEdit}
                      value={item.documentType}
                      placeholder="Document type"
                      onChange={event =>
                        setDraft(prev => {
                          const checklist = [...prev.documents.checklist];
                          checklist[index] = { ...checklist[index], documentType: event.target.value };
                          return { ...prev, documents: { ...prev.documents, checklist } };
                        })
                      }
                    />
                    <Select
                      value={item.mandatory ? 'mandatory' : 'optional'}
                      disabled={!canEdit}
                      onValueChange={value =>
                        setDraft(prev => {
                          const checklist = [...prev.documents.checklist];
                          checklist[index] = { ...checklist[index], mandatory: value === 'mandatory' };
                          return { ...prev, documents: { ...prev.documents, checklist } };
                        })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mandatory">Mandatory</SelectItem>
                        <SelectItem value="optional">Optional</SelectItem>
                      </SelectContent>
                    </Select>
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-rose-700"
                        onClick={() =>
                          setDraft(prev => ({
                            ...prev,
                            documents: {
                              ...prev.documents,
                              checklist: prev.documents.checklist.filter((_, i) => i !== index),
                            },
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Interviews ── */}
        <TabsContent value="interviews">
          <HrSection
            title="Interview settings"
            description="Spec sections 24 to 26."
            actions={<SaveButton section="interviews" label="Interview settings" />}
          >
            <div className="mb-3">
              <Label className="text-xs">Interview rounds in use</Label>
              <Textarea
                rows={2}
                disabled={!canEdit}
                value={draft.interviews.rounds.join(', ')}
                onChange={event =>
                  setDraft(prev => ({
                    ...prev,
                    interviews: {
                      ...prev.interviews,
                      rounds: parseList(event.target.value) as typeof prev.interviews.rounds,
                    },
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Available: {INTERVIEW_ROUNDS.join(', ')}.
              </p>
            </div>

            <div className="mb-3">
              <Label className="text-xs">Feedback reminder after (hours)</Label>
              <Input
                type="number"
                inputMode="decimal"
                disabled={!canEdit}
                value={draft.interviews.feedbackReminderHours}
                onChange={event =>
                  setDraft(prev => ({
                    ...prev,
                    interviews: { ...prev.interviews, feedbackReminderHours: Number(event.target.value) || 24 },
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">Allow interviewers to revise their own feedback</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Off by default. Submitted feedback stays append-only either way — a revision is stored beside
                    the original, never over it (control rule 63.6).
                  </span>
                </span>
                <Switch
                  checked={draft.interviews.allowAuthorFeedbackRevision}
                  disabled={!canEdit}
                  onCheckedChange={value =>
                    setDraft(prev => ({ ...prev, interviews: { ...prev.interviews, allowAuthorFeedbackRevision: value } }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className="text-sm text-slate-800">Require comments when a candidate is not recommended</span>
                <Switch
                  checked={draft.interviews.requireCommentsOnRejection}
                  disabled={!canEdit}
                  onCheckedChange={value =>
                    setDraft(prev => ({ ...prev, interviews: { ...prev.interviews, requireCommentsOnRejection: value } }))
                  }
                />
              </label>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Referrals ── */}
        <TabsContent value="referrals">
          <HrSection
            title="Employee referrals"
            description="Spec section 46."
            actions={<SaveButton section="referrals" label="Referral settings" />}
          >
            <label className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <span className="text-sm font-medium text-slate-800">Referrals enabled</span>
              <Switch
                checked={draft.referrals.enabled}
                disabled={!canEdit}
                onCheckedChange={value => setDraft(prev => ({ ...prev, referrals: { ...prev.referrals, enabled: value } }))}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Reward amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={draft.referrals.rewardAmount}
                  onChange={event =>
                    setDraft(prev => ({
                      ...prev,
                      referrals: { ...prev.referrals, rewardAmount: Number(event.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Payable after (days on roll)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={draft.referrals.rewardAfterDays}
                  onChange={event =>
                    setDraft(prev => ({
                      ...prev,
                      referrals: { ...prev.referrals, rewardAfterDays: Number(event.target.value) || 0 },
                    }))
                  }
                />
              </div>
            </div>
          </HrSection>
        </TabsContent>

        {/* ── Notifications ── */}
        <TabsContent value="notifications">
          <HrSection
            title="Notification events"
            description="Spec section 49 — which events raise an in-app and push notification."
            actions={<SaveButton section="notifications" label="Notification rules" />}
          >
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {(Object.keys(draft.notifications) as Array<keyof HrSettings['notifications']>).map(key => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm text-slate-800">
                    {key
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, char => char.toUpperCase())
                      .trim()}
                  </span>
                  <Switch
                    checked={draft.notifications[key]}
                    disabled={!canEdit}
                    onCheckedChange={value =>
                      setDraft(prev => ({ ...prev, notifications: { ...prev.notifications, [key]: value } }))
                    }
                  />
                </label>
              ))}
            </div>
          </HrSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Approval rule editor (spec sections 12, 13)
 * ---------------------------------------------------------------------------------------------- */

function RuleEditor({
  rules,
  canEdit,
  onChange,
}: {
  rules: HrApprovalRule[];
  canEdit: boolean;
  onChange: (rules: HrApprovalRule[]) => void;
}) {
  const update = (index: number, patch: Partial<HrApprovalRule>) => {
    const next = [...rules];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const conditionSummary = (rule: HrApprovalRule) => {
    const when = rule.when || {};
    const parts: string[] = [];
    if (when.requirementTypes?.length) parts.push(when.requirementTypes.join(' / '));
    if (when.employmentTypes?.length) parts.push(when.employmentTypes.join(' / '));
    if (when.priorities?.length) parts.push(`priority ${when.priorities.join(' / ')}`);
    if (when.grades?.length) parts.push(`grade ${when.grades.join(' / ')}`);
    if (when.seniorManagement !== undefined) parts.push(when.seniorManagement ? 'senior management' : 'not senior management');
    if (when.salaryIncrease !== undefined) parts.push(when.salaryIncrease ? 'with salary increase' : 'no salary increase');
    if (when.ctcAboveBand !== undefined) parts.push(when.ctcAboveBand ? 'CTC above band' : 'CTC within band');
    if (when.withinManpowerPlan !== undefined) parts.push(when.withinManpowerPlan ? 'within plan' : 'outside plan');
    if (when.aboveSanctionedStrength !== undefined) {
      parts.push(when.aboveSanctionedStrength ? 'above sanctioned strength' : 'within sanctioned strength');
    }
    if (when.minPositions !== undefined) parts.push(`${when.minPositions}+ positions`);
    if (when.minAnnualCost !== undefined) parts.push(`annual cost ≥ ${when.minAnnualCost}`);
    return parts.length ? parts.join(', ') : 'matches everything';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Rules ({rules.length})</Label>
        {canEdit && rules.length === 0 && (
          <Button size="sm" variant="outline" onClick={() => onChange(DEFAULT_HR_APPROVAL_RULES)}>
            Load the default matrix
          </Button>
        )}
      </div>

      {rules.map((rule, index) => (
        <div key={rule.id || index} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-800">{rule.name}</p>
                {rule.fastTrack && (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">fast track</Badge>
                )}
                {rule.active === false && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px]">inactive</Badge>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">When: {conditionSummary(rule)}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">
                {(rule.stages || []).map(stage => HR_APPROVAL_STAGE_LABELS[stage.key] || stage.key).join(' → ')}
              </p>
            </div>

            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={rule.active !== false}
                  onCheckedChange={value => update(index, { active: value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-rose-700"
                  onClick={() => onChange(rules.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-muted-foreground">
          No rules configured. Every submitted requirement will use the fallback chain below.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Rules cover the conditions of spec section 13 — requirement type, employment type, priority, grade,
        senior management, salary increase, CTC above band, within or above the sanctioned plan, position count
        and annual cost. Editing a rule&apos;s conditions and stages in place is planned; for now, load the
        default matrix and switch off what does not apply.
      </p>
    </div>
  );
}
