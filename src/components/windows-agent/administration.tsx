'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, ScrollText, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrLoader,
  HrPageHeader,
  hrDialog,
} from '@/components/hr/hr-ui';
import { hasPermission } from '@/lib/access-control';
import {
  AGENT_POLICY_KEYS,
  DEFAULT_AGENT_POLICY,
  WINDOWS_AGENT_RESOURCES,
  describePolicySource,
  resolveAgentPolicy,
  type AgentPolicySettings,
  type AppCategory,
  type PolicyScopeKind,
  type WindowsAgentPolicy,
} from '@/lib/windows-agent';
import {
  canCategoriseApplications,
  canManagePolicies,
  canManageVersions,
  canViewAudit,
} from '@/lib/windows-agent-permissions';
import {
  deletePolicy,
  fetchAgentVersions,
  fetchAppCatalog,
  fetchAuditLogs,
  fetchPolicies,
  publishAgentVersion,
  savePolicy,
  setAppCategory,
  withdrawAgentVersion,
} from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';
import { CategoryBadge, ClockTime, categoryLabel } from './ui';

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Policies (§35)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

const SETTING_LABELS: Record<keyof AgentPolicySettings, { label: string; help: string }> = {
  requireMorningLogin: {
    label: 'Show the access gate at start-up',
    help: 'Off by default. Turn this on only after the agent, sign-in and the recovery shortcut have been proven on pilot machines — see the staged rollout in the documentation.',
  },
  requireLoginAfterRestart: {
    label: 'Ask again after a restart',
    help: 'When off, a restart mid-morning resumes the saved sign-in without a password.',
  },
  idleThresholdSeconds: { label: 'Idle after (seconds)', help: 'No keyboard or mouse for this long counts as idle.' },
  extendedIdleThresholdSeconds: {
    label: 'Extended idle after (seconds)',
    help: 'Must be longer than the idle threshold; the resolver raises it automatically if a narrower policy makes it shorter.',
  },
  offlineGraceMinutes: {
    label: 'Offline grace (minutes)',
    help: 'How long the agent may accept a cached sign-in with no network. Zero forbids offline sign-in entirely.',
  },
  heartbeatIntervalSeconds: { label: 'Heartbeat every (seconds)', help: '30–900. Shorter means a fresher live board and more writes.' },
  activityBatchIntervalSeconds: { label: 'Upload activity every (seconds)', help: 'How often queued spans are sent. Never shorter than the heartbeat.' },
  applicationTrackingEnabled: { label: 'Track foreground applications', help: 'The core of the module. Turning it off also turns off window titles and website domains.' },
  windowTitleTrackingEnabled: {
    label: 'Record window titles',
    help: 'Off by default. Titles are sanitised of emails and card numbers, but they still reveal document and email subjects. Enable only under an agreed monitoring policy.',
  },
  browserDomainTrackingEnabled: {
    label: 'Record website domains',
    help: 'Off by default. Gives time per site — drive.google.com, 25 minutes. Domains only, never paths, search terms or page contents, and nothing at all is read from the address bar while this is off.',
  },
  documentNameTrackingEnabled: {
    label: 'Record document names',
    help: 'Off by default. Which file was open in Excel, Word, AutoCAD or a PDF reader — the name only. Never cell contents, formulas or text.',
  },
  notificationMode: { label: 'Desktop notifications', help: 'How alerts appear on the PC.' },
  autoUpdateEnabled: { label: 'Update the agent automatically', help: 'Within the device’s rollout ring.' },
  workdayStart: { label: 'Workday starts', help: 'Used to flag late sign-ins. Never used to block one.' },
  workdayEnd: { label: 'Workday ends', help: 'Reporting only.' },
  lateLoginGraceMinutes: { label: 'Late grace (minutes)', help: 'Minutes after the start before a sign-in is flagged late.' },
  allowUserPauseTracking: { label: 'Let employees pause tracking', help: 'Adds "Pause tracking" to the tray menu.' },
  rawActivityRetentionDays: {
    label: 'Keep raw activity for (days)',
    help: 'Daily totals and attendance are kept regardless; this is the detailed timeline only.',
  },
  lockOnIdleEnabled: {
    label: 'Lock the PC when it is left unattended',
    help: 'Off by default. Shows a countdown first, and locks with the ordinary Windows lock screen — the person signs back in with their Windows password. Prove it on pilot machines before switching it on for a site.',
  },
  idleLockSeconds: {
    label: 'Lock after idle for (seconds)',
    help: 'Separate from the idle threshold above, which only classifies recorded time. 600 is ten minutes — short enough to matter, long enough to survive a phone call. Minimum 120.',
  },
  idleLockWarningSeconds: {
    label: 'Countdown before locking (seconds)',
    help: 'How long "Are you still working?" stays on screen. Any key or mouse movement cancels it. Minimum 15.',
  },
  lockOnErpWindowClose: {
    label: 'Closing the SEL LIVE window locks the PC',
    help: 'For installations where that window is the working session. It also opens automatically at sign-in. Off by default: with it on, a misplaced click on the X costs somebody their unlocked desktop.',
  },
  lockOnSignOut: {
    label: 'Signing out locks the PC',
    help: 'Off by default. Without it, signing out leaves somebody at an unlocked desktop with nothing being recorded — the one way to work unmonitored that needs no administrator. Pair it with the access gate above, which decides whether the next sign-in can be dismissed.',
  },
  requireAdminToExit: {
    label: 'Closing the agent needs an administrator',
    help: 'On by default. The tray’s Exit asks for a SEL LIVE sign-in and checks Windows Agent / Devices / Edit. Turn it off for an installation that reports without enforcing attendance.',
  },
  maxSpanMinutes: {
    label: 'Longest activity block (minutes)',
    help: 'The granularity of the record: at 10, two hours in one application is twelve rows rather than one, which is what makes the hour-by-hour timeline readable. Lower for finer detail, higher to cut writes on a large fleet. 1–60.',
  },
  requestTimeoutSeconds: {
    label: 'Give up on a request after (seconds)',
    help: 'Raise it for a site office on a slow or satellite link, where 30s makes every heartbeat look like the server is down. A request that times out is retried from the offline queue, so patience costs time rather than data. 10–180.',
  },
  reauthAfterLockSeconds: {
    label: 'Sign in to SEL LIVE again after locked for (seconds)',
    help: '1800 is half an hour: a walk to the printer resumes silently, a lunch break asks again. Zero asks on every unlock; a very large number never does.',
  },
};

export function PoliciesPage() {
  const { viewer, actor, departments, directory, loading } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const [editing, setEditing] = useState<WindowsAgentPolicy | 'new' | null>(null);

  const allowed =
    canManagePolicies(viewer) || hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.policies, 'View');
  const canEdit = canManagePolicies(viewer);

  const policies = useWindowsAgentQuery('Loading policies', fetchPolicies, [], {
    enabled: allowed && !loading,
  });

  if (loading) return <HrLoader label="Loading policies" />;
  if (!allowed) return <HrAccessDenied what="Windows Agent policies" />;

  const rows = (policies.data ?? []).slice().sort((left, right) => {
    const order: PolicyScopeKind[] = ['COMPANY', 'DEPARTMENT', 'USER', 'DEVICE'];
    return order.indexOf(left.scopeKind) - order.indexOf(right.scopeKind) ||
      left.scopeLabel.localeCompare(right.scopeLabel);
  });

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Policies"
        description="Company, department, user and device. A narrower policy overrides only the settings it names — everything else keeps inheriting."
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              New policy
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-6">
          {policies.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              dense
              onRowClick={canEdit ? (row) => setEditing(row) : undefined}
              columns={[
                {
                  header: 'Scope',
                  mobile: 'title',
                  cell: (row) => (
                    <span>
                      <span className="block font-medium">{row.scopeLabel}</span>
                      <span className="block text-xs text-muted-foreground">{row.scopeKind.toLowerCase()}</span>
                    </span>
                  ),
                },
                {
                  header: 'Settings',
                  mobile: 'detail',
                  cell: (row) => {
                    const count = Object.keys(row.settings ?? {}).length;
                    return `${count} ${count === 1 ? 'setting' : 'settings'} overridden`;
                  },
                },
                {
                  header: 'State',
                  mobile: 'aside',
                  cell: (row) =>
                    row.enabled ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    ),
                },
                {
                  header: '',
                  align: 'right',
                  mobile: 'footer',
                  cell: (row) =>
                    canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={pending}
                        onClick={async (event) => {
                          event.stopPropagation();
                          await run('Policy deleted', () => deletePolicy(actor, row));
                          policies.refresh();
                        }}
                      >
                        Delete
                      </Button>
                    ) : null,
                },
              ]}
              empty={
                <HrEmptyState
                  title="No policies yet"
                  description="Without any policy every agent runs on the built-in defaults: tracking on, access gate off, window titles off."
                />
              }
            />
          )}
        </CardContent>
      </Card>

      <ResolvedPreview policies={policies.data ?? []} />

      {editing ? (
        <PolicyEditor
          policy={editing === 'new' ? null : editing}
          departments={departments}
          people={directory}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            policies.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What an agent would actually run, for a chosen department.
 *
 * The single most useful thing this page can show. Four policy documents can apply to one PC and
 * the answer is per setting, so "what is in force on a machine in Accounts" is a question nobody
 * can answer by reading the list above — which is how a policy people do not trust comes about.
 */
function ResolvedPreview({ policies }: { policies: WindowsAgentPolicy[] }) {
  const { departments } = useWindowsAgent();
  const [departmentId, setDepartmentId] = useState<string>('none');

  const resolved = useMemo(
    () =>
      resolveAgentPolicy(policies, {
        userId: null,
        deviceId: null,
        departmentIds: departmentId === 'none' ? [] : [departmentId],
      }),
    [policies, departmentId],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">What an agent would run</CardTitle>
          <CardDescription>
            The resolved policy, with where each value came from.
          </CardDescription>
        </div>
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Company-wide" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Company-wide</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {AGENT_POLICY_KEYS.map((key) => {
            const value = resolved.settings[key];
            const source = resolved.sources[key];
            return (
              <div key={key} className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-b-0">
                <span className="min-w-0 truncate" title={SETTING_LABELS[key]?.help}>
                  {SETTING_LABELS[key]?.label ?? key}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value)}
                  </span>
                  <Badge
                    variant="outline"
                    className={source === 'DEFAULT' ? 'text-[10px] text-muted-foreground' : 'text-[10px]'}
                    title={describePolicySource(source)}
                  >
                    {source.toLowerCase()}
                  </Badge>
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyEditor({
  policy,
  departments,
  people,
  onClose,
  onSaved,
}: {
  policy: WindowsAgentPolicy | null;
  departments: { id: string; name: string }[];
  people: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { actor } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const [scopeKind, setScopeKind] = useState<PolicyScopeKind>(policy?.scopeKind ?? 'COMPANY');
  const [scopeId, setScopeId] = useState<string>(policy?.scopeId ?? '');
  const [enabled, setEnabled] = useState(policy?.enabled !== false);
  const [settings, setSettings] = useState<AgentPolicySettings>(policy?.settings ?? {});

  const scopeLabel = useMemo(() => {
    if (scopeKind === 'COMPANY') return 'Company';
    if (scopeKind === 'DEPARTMENT') return departments.find((entry) => entry.id === scopeId)?.name ?? 'Department';
    if (scopeKind === 'USER') return people.find((entry) => entry.id === scopeId)?.name ?? 'User';
    return scopeId || 'Device';
  }, [scopeKind, scopeId, departments, people]);

  // A key present with `undefined` means "inherit"; a key absent from the object entirely means
  // the same thing. Toggling a setting on and off must therefore delete it rather than set a
  // default, or the policy would start overriding a value the administrator never chose.
  const setSetting = <K extends keyof AgentPolicySettings>(key: K, value: AgentPolicySettings[K] | undefined) => {
    setSettings((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const save = async () => {
    const ok = await run('Policy saved', () =>
      savePolicy(actor, {
        id: policy?.id,
        scopeKind,
        scopeId: scopeKind === 'COMPANY' ? null : scopeId || null,
        scopeLabel,
        enabled,
        settings,
      }).then(() => undefined),
    );
    if (ok) onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={hrDialog.contentTall}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{policy ? 'Edit policy' : 'New policy'}</DialogTitle>
          <DialogDescription>
            Only the settings you switch on here are overridden. Everything else keeps inheriting
            from a broader policy, or from the built-in default.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyScroll}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={scopeKind} onValueChange={(value) => setScopeKind(value as PolicyScopeKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY">Everybody</SelectItem>
                  <SelectItem value="DEPARTMENT">A department</SelectItem>
                  <SelectItem value="USER">One person</SelectItem>
                  <SelectItem value="DEVICE">One computer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scopeKind !== 'COMPANY' ? (
              <div className="space-y-1.5">
                <Label>{scopeKind === 'DEVICE' ? 'Device id' : 'Which one'}</Label>
                {scopeKind === 'DEVICE' ? (
                  <Input value={scopeId} onChange={(event) => setScopeId(event.target.value)} placeholder="Device id" />
                ) : (
                  <Select value={scopeId} onValueChange={setScopeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(scopeKind === 'DEPARTMENT' ? departments : people).map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : null}
          </div>

          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm font-medium">Policy enabled</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>

          <div className="space-y-2">
            {AGENT_POLICY_KEYS.map((key) => {
              const overridden = settings[key] !== undefined;
              const fallback = DEFAULT_AGENT_POLICY[key];
              const meta = SETTING_LABELS[key];

              return (
                <div key={key} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta?.label ?? key}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{meta?.help}</p>
                    </div>
                    <Switch
                      checked={overridden}
                      onCheckedChange={(checked) => setSetting(key, checked ? (fallback as never) : undefined)}
                      aria-label={`Override ${meta?.label ?? key}`}
                    />
                  </div>

                  {overridden ? (
                    <div className="mt-3">
                      {typeof fallback === 'boolean' ? (
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={settings[key] as boolean}
                            onCheckedChange={(checked) => setSetting(key, checked as never)}
                          />
                          {(settings[key] as boolean) ? 'On' : 'Off'}
                        </label>
                      ) : key === 'notificationMode' ? (
                        <Select
                          value={String(settings[key])}
                          onValueChange={(value) => setSetting(key, value as never)}
                        >
                          <SelectTrigger className="max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TOAST_AND_TRAY">Popup and tray</SelectItem>
                            <SelectItem value="TRAY_ONLY">Tray only — no popup</SelectItem>
                            <SelectItem value="CRITICAL_ONLY">Only high and critical</SelectItem>
                            <SelectItem value="OFF">Off</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="max-w-xs"
                          value={String(settings[key] ?? '')}
                          onChange={(event) =>
                            setSetting(
                              key,
                              (typeof fallback === 'number'
                                ? Number(event.target.value.replace(/\D/g, '')) || 0
                                : event.target.value) as never,
                            )
                          }
                          placeholder={String(fallback)}
                          inputMode={typeof fallback === 'number' ? 'numeric' : undefined}
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || (scopeKind !== 'COMPANY' && !scopeId)}>
            Save policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Application catalogue (§22)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

const ALL_CATEGORIES: AppCategory[] = [
  'ERP',
  'OFFICE',
  'COMMUNICATION',
  'DEVELOPMENT',
  'REFERENCE',
  'WORK',
  'SYSTEM',
  'UNCLASSIFIED',
];

export function ApplicationCatalogPage() {
  const { viewer, actor, loading } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const [search, setSearch] = useState('');

  const allowed = hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.applications, 'View');
  const canEdit = canCategoriseApplications(viewer);

  const catalog = useWindowsAgentQuery('Loading the application catalogue', fetchAppCatalog, [], {
    enabled: allowed && !loading,
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (catalog.data ?? [])
      .filter((entry) =>
        !needle ? true : entry.displayName.toLowerCase().includes(needle) || entry.id.includes(needle),
      )
      // Anything auto-discovered first: those are what somebody actually needs to look at.
      .sort((left, right) =>
        Number(right.autoDiscovered) - Number(left.autoDiscovered) ||
        left.displayName.localeCompare(right.displayName),
      );
  }, [catalog.data, search]);

  if (loading) return <HrLoader label="Loading applications" />;
  if (!allowed) return <HrAccessDenied what="the application catalogue" />;

  const unreviewed = rows.filter((row) => row.autoDiscovered).length;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Applications"
        description="How each program is classified. Categories describe software — they are never a judgement about the person using it."
      />

      {unreviewed > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-amber-900">
              {unreviewed} {unreviewed === 1 ? 'program was' : 'programs were'} discovered
              automatically and {unreviewed === 1 ? 'has' : 'have'} not been reviewed. Until they
              are classified they appear as <em>Unclassified</em> in every report.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{rows.length} {rows.length === 1 ? 'program' : 'programs'}</CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name or process"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          {catalog.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              dense
              maxHeightClassName="sm:max-h-[40rem]"
              columns={[
                {
                  header: 'Application',
                  mobile: 'title',
                  cell: (row) => (
                    <span>
                      <span className="block font-medium">{row.displayName}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{row.id}</span>
                    </span>
                  ),
                },
                {
                  header: 'Source',
                  className: 'hidden md:table-cell',
                  mobile: 'detail',
                  cell: (row) =>
                    row.autoDiscovered ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Needs review
                      </Badge>
                    ) : row.isBuiltIn ? (
                      <span className="text-xs text-muted-foreground">Built in</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Set by an administrator</span>
                    ),
                },
                {
                  header: 'Category',
                  align: 'right',
                  mobile: 'footer',
                  cell: (row) =>
                    canEdit ? (
                      <Select
                        value={row.category}
                        disabled={pending}
                        onValueChange={async (value) => {
                          await run('Category updated', () =>
                            setAppCategory(actor, row, value as AppCategory),
                          );
                          catalog.refresh();
                        }}
                      >
                        <SelectTrigger className="ml-auto w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {categoryLabel(category)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <CategoryBadge category={row.category} />
                    ),
                },
              ]}
              empty={
                <HrEmptyState
                  title="No programs recorded yet"
                  description="The catalogue fills itself as agents report what people actually use."
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Agent versions (§43)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function AgentVersionsPage() {
  const { viewer, actor, loading } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const [publishing, setPublishing] = useState(false);

  const allowed =
    canManageVersions(viewer) || hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.versions, 'View');
  const canPublish = canManageVersions(viewer);

  const versions = useWindowsAgentQuery('Loading agent versions', fetchAgentVersions, [], {
    enabled: allowed && !loading,
  });

  if (loading) return <HrLoader label="Loading agent versions" />;
  if (!allowed) return <HrAccessDenied what="agent versions" />;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Agent versions"
        description="Published builds and which rollout rings receive them."
        actions={
          canPublish ? (
            <Button size="sm" onClick={() => setPublishing(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Publish a build
            </Button>
          ) : null
        }
      />

      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          <p className="text-blue-900">
            An agent verifies the SHA-256 <em>and</em> the Authenticode signature of an installer
            before it runs it. A version record with the wrong hash is not a cosmetic mistake — the
            update will silently never apply, which is much harder to notice than a failure. The
            build script prints the correct hash.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {versions.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={versions.data ?? []}
              dense
              columns={[
                { header: 'Version', mobile: 'title', cell: (row) => <span className="font-mono">{row.version}</span> },
                {
                  header: 'Channel',
                  mobile: 'aside',
                  cell: (row) => (
                    <Badge
                      variant="outline"
                      className={
                        row.channel === 'STABLE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : row.channel === 'WITHDRAWN'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : ''
                      }
                    >
                      {row.channel.toLowerCase()}
                    </Badge>
                  ),
                },
                { header: 'Rings', mobile: 'detail', cell: (row) => (row.rings ?? []).join(', ') || '—' },
                { header: 'Published', mobile: 'detail', cell: (row) => <ClockTime value={row.publishedAt} /> },
                {
                  header: 'Notes',
                  className: 'hidden lg:table-cell',
                  mobile: 'detail',
                  cell: (row) => <span className="line-clamp-2 text-xs text-muted-foreground">{row.releaseNotes}</span>,
                },
                {
                  header: '',
                  align: 'right',
                  mobile: 'footer',
                  cell: (row) =>
                    canPublish && row.channel !== 'WITHDRAWN' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={async () => {
                          await run('Version withdrawn', () => withdrawAgentVersion(actor, row));
                          versions.refresh();
                        }}
                      >
                        Withdraw
                      </Button>
                    ) : null,
                },
              ]}
              empty={
                <HrEmptyState
                  title="No builds published"
                  description="Run windows/SEL.Agent.Installer/build.ps1, then publish the version with the SHA-256 it prints."
                />
              }
            />
          )}
        </CardContent>
      </Card>

      {publishing ? (
        <PublishVersionDialog
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            versions.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PublishVersionDialog({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const { actor } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const [version, setVersion] = useState('');
  const [packageUrl, setPackageUrl] = useState('');
  const [packageSha256, setPackageSha256] = useState('');
  const [signatureSubject, setSignatureSubject] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [rings, setRings] = useState<string[]>(['PILOT']);

  const toggleRing = (ring: string) =>
    setRings((current) => (current.includes(ring) ? current.filter((entry) => entry !== ring) : [...current, ring]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader>
          <DialogTitle>Publish an agent build</DialogTitle>
          <DialogDescription>
            Start with the Pilot ring only. Widening a release is one edit; recalling one that has
            already installed on four hundred machines is not.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wa-version">Version</Label>
              <Input id="wa-version" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.4.2" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-subject">Signature subject</Label>
              <Input
                id="wa-subject"
                value={signatureSubject}
                onChange={(event) => setSignatureSubject(event.target.value)}
                placeholder="Siddhartha Engineering Limited"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-url">Package URL (https)</Label>
            <Input id="wa-url" value={packageUrl} onChange={(event) => setPackageUrl(event.target.value)} placeholder="https://…/SEL.Agent-1.4.2.msi" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-sha">SHA-256</Label>
            <Input
              id="wa-sha"
              value={packageSha256}
              onChange={(event) => setPackageSha256(event.target.value.trim())}
              placeholder="printed by build.ps1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-notes">Release notes</Label>
            <Textarea id="wa-notes" value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Rings</Label>
            <div className="flex flex-wrap gap-2">
              {['PILOT', 'EARLY', 'BROAD'].map((ring) => (
                <Button
                  key={ring}
                  type="button"
                  size="sm"
                  variant={rings.includes(ring) ? 'default' : 'outline'}
                  onClick={() => toggleRing(ring)}
                >
                  {ring.toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !version || !packageUrl || !packageSha256 || !signatureSubject}
            onClick={async () => {
              const ok = await run('Build published', () =>
                publishAgentVersion(actor, {
                  version,
                  channel: 'STABLE',
                  releaseNotes,
                  packageUrl,
                  packageSha256,
                  signatureSubject,
                  packageSizeBytes: null,
                  rings: rings as never,
                  minimumSupportedVersion: null,
                }),
              );
              if (ok) onPublished();
            }}
          >
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Audit log (§50)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function AuditLogPage() {
  const { viewer, loading } = useWindowsAgent();
  const [search, setSearch] = useState('');

  const allowed = canViewAudit(viewer);
  const logs = useWindowsAgentQuery('Loading the audit log', () => fetchAuditLogs(300), [], {
    enabled: allowed && !loading,
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (logs.data ?? []).filter((row) =>
      !needle
        ? true
        : row.action.toLowerCase().includes(needle) ||
          row.actorName.toLowerCase().includes(needle) ||
          row.targetLabel.toLowerCase().includes(needle),
    );
  }, [logs.data, search]);

  if (loading) return <HrLoader label="Loading the audit log" />;
  if (!allowed) return <HrAccessDenied what="the Windows Agent audit log" />;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Audit log"
        description="Every administrative action in this module. Append-only — nobody can edit or delete a row, including the people who write them."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" aria-hidden />
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
          </CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by action, person or target"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          {logs.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              dense
              maxHeightClassName="sm:max-h-[40rem]"
              columns={[
                { header: 'When', mobile: 'aside', cell: (row) => <ClockTime value={row.at} /> },
                {
                  header: 'Action',
                  mobile: 'title',
                  cell: (row) => <span className="font-medium">{row.action.replace(/_/g, ' ').toLowerCase()}</span>,
                },
                { header: 'By', mobile: 'detail', cell: (row) => row.actorName },
                { header: 'Target', mobile: 'detail', cell: (row) => row.targetLabel },
                {
                  header: 'Reason',
                  className: 'hidden lg:table-cell',
                  mobile: 'footer',
                  cell: (row) =>
                    row.reason ? (
                      <span className="text-xs text-muted-foreground">{row.reason}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    ),
                },
              ]}
              empty={<HrEmptyState title="Nothing recorded yet" description="Administrative actions appear here as they happen." />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
