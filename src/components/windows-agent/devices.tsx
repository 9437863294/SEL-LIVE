'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, ChevronDown, HardDrive, KeyRound, LogOut, Plus, RotateCcw, ShieldCheck, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SearchInput } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  HrKpiCard,
  HrLoader,
  hrDialog,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import {
  WINDOWS_AGENT_ROUTES,
  WINDOWS_DEVICE_SECURITY_POLICY,
  describeSecurityFinding,
  evaluateAgentHealth,
  resolveDeviceSecurityPolicy,
  type WindowsDevice,
  type WindowsDeviceSecurityPolicy,
  type WindowsDeviceSecurityPosture,
} from '@/lib/windows-agent';
import {
  canAssignDeviceUsers,
  canBlockDevice,
  canForceReauth,
  canManageDevices,
  canManageEnrollmentCodes,
  canSignOutUser,
  canViewDevices,
} from '@/lib/windows-agent-permissions';
import {
  createEnrollmentCode,
  changeDeviceMaintenanceAccess,
  changeDeviceSecurityPolicy,
  fetchDevice,
  fetchDevices,
  fetchEnrollmentCodes,
  requestDeviceAction,
  setDeviceAssignment,
  setDeviceStatus,
  setDeviceUpdateRing,
  setEnrollmentCodeEnabled,
  type DirectoryEntry,
} from '@/lib/windows-agent-service';
import { useTickingNow, useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';
import { ClockTime, DeviceStatusBadge, RelativeTime, relativeLabel } from './ui';
import { PageHeader } from '@/components/shared/page-header';

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Device register (§34)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function DevicesPage() {
  const { viewer, loading } = useWindowsAgent();
  const now = useTickingNow(30_000);
  const [search, setSearch] = useState('');
  const [codesOpen, setCodesOpen] = useState(false);

  const allowed = canViewDevices(viewer);
  const devices = useWindowsAgentQuery('Loading devices', fetchDevices, [], {
    enabled: allowed && !loading,
  });

  const rows = useMemo(() => {
    const all = devices.data ?? [];
    const needle = search.trim().toLowerCase();
    return all
      .map((device) => ({
        ...device,
        health: evaluateAgentHealth({
          status: device.status,
          lastHeartbeatAt: device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt) : null,
          agentVersion: device.agentVersion,
          latestVersion: null,
          queuedSpanCount: 0,
          clockSkewSeconds: 0,
          heartbeatIntervalSeconds: 90,
          securityCompliant: device.securityPosture?.compliant ?? null,
          now,
        }),
      }))
      .filter((device) =>
        !needle
          ? true
          : device.deviceName.toLowerCase().includes(needle) ||
            (device.facts?.hostname ?? '').toLowerCase().includes(needle) ||
            (device.departmentName ?? '').toLowerCase().includes(needle) ||
            (device.lastSeenUserName ?? '').toLowerCase().includes(needle),
      );
  }, [devices.data, search, now]);

  const counts = useMemo(
    () => ({
      total: (devices.data ?? []).length,
      pending: (devices.data ?? []).filter((device) => device.status === 'PENDING').length,
      active: (devices.data ?? []).filter((device) => device.status === 'ACTIVE').length,
      problems: rows.filter((row) => row.health.length > 0).length,
    }),
    [devices.data, rows],
  );

  if (loading) return <HrLoader label="Loading devices" />;
  if (!allowed) return <HrAccessDenied what="the device register" />;

  type Row = (typeof rows)[number];

  const columns: HrListColumn<Row>[] = [
    {
      header: 'Computer',
      mobile: 'title',
      cell: (device) => (
        <Link href={WINDOWS_AGENT_ROUTES.device(device.id)} className="hover:underline" prefetch={false}>
          <span className="block font-medium">{device.deviceName}</span>
          <span className="block text-xs text-muted-foreground">{device.facts?.hostname}</span>
        </Link>
      ),
    },
    {
      header: 'Department',
      className: 'hidden md:table-cell',
      mobile: 'detail',
      cell: (device) => device.departmentName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: 'Windows',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (device) => (
        <span className="text-sm text-muted-foreground">{device.facts?.windowsVersion ?? '—'}</span>
      ),
    },
    {
      header: 'Agent',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (device) => device.agentVersion ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: 'Last user',
      mobile: 'detail',
      cell: (device) => device.lastSeenUserName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (device) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <DeviceStatusBadge status={device.status} />
          {device.health.map((flag) => (
            <StatusBadge key={flag} status={flag} tone="warning">
              {flag.replace(/_/g, ' ').toLowerCase()}
            </StatusBadge>
          ))}
        </span>
      ),
    },
    {
      header: 'Last heartbeat',
      align: 'right',
      mobile: 'footer',
      cell: (device) => <RelativeTime value={device.lastHeartbeatAt} now={now} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Devices"
        description="Every computer running the SEL LIVE agent."
        actions={
          canManageEnrollmentCodes(viewer) ? (
            <Button size="sm" onClick={() => setCodesOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" aria-hidden />
              Enrolment codes
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKpiCard label="Enrolled" value={counts.total} icon={HardDrive} tone="blue" />
        <HrKpiCard label="Active" value={counts.active} tone="emerald" />
        <HrKpiCard
          label="Awaiting approval"
          value={counts.pending}
          tone={counts.pending ? 'amber' : 'slate'}
        />
        <HrKpiCard label="Agent problems" value={counts.problems} tone={counts.problems ? 'rose' : 'slate'} />
      </div>

      <TableCard
        title="Device register"
        count={rows.length}
        total={counts.total}
        noun="computer"
        toolbar={<SearchInput value={search} onChange={setSearch} placeholder="Filter by name, hostname, department or user" className="sm:max-w-xs" />}
      >
          {devices.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              columns={columns}
              dense
              frameless
              cardHref={(device) => WINDOWS_AGENT_ROUTES.device(device.id)}
              empty={
                <HrEmptyState
                  icon={HardDrive}
                  title="No computers enrolled"
                  description="Create an enrolment code, then run the installer on a pilot PC with ENROLLMENTCODE set to it."
                />
              }
            />
          )}
      </TableCard>

      <EnrollmentCodesDialog open={codesOpen} onOpenChange={setCodesOpen} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * Enrolment codes (§45)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

function EnrollmentCodesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { viewer, actor, departments } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const codes = useWindowsAgentQuery('Loading enrolment codes', fetchEnrollmentCodes, [open], {
    enabled: open,
  });

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('none');
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxRegistrations, setMaxRegistrations] = useState('');

  const canManage = canManageEnrollmentCodes(viewer);

  const create = async () => {
    const department = departments.find((entry) => entry.id === departmentId);
    const ok = await run('Enrolment code created', async () => {
      await createEnrollmentCode(actor, {
        code,
        label: label || code,
        departmentId: departmentId === 'none' ? null : departmentId,
        departmentName: department?.name ?? null,
        assignedLocation: null,
        autoApprove,
        maxRegistrations: maxRegistrations.trim() ? Number(maxRegistrations) : null,
        expiresAt: null,
      });
    });
    if (ok) {
      setCode('');
      setLabel('');
      setMaxRegistrations('');
      codes.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentTall}>
        <DialogHeader>
          <DialogTitle>Enrolment codes</DialogTitle>
          <DialogDescription>
            A computer redeems a code once, at install, and is issued its own credential. The code
            is removed from the PC afterwards, so an enrolled machine is not carrying one.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyScroll}>
          {canManage ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">New code</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wa-code">Code</Label>
                  <Input
                    id="wa-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="SEL-HO-2026"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-code-label">Label</Label>
                  <Input
                    id="wa-code-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Head office rollout"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-code-max">Maximum registrations</Label>
                  <Input
                    id="wa-code-max"
                    value={maxRegistrations}
                    onChange={(event) => setMaxRegistrations(event.target.value.replace(/\D/g, ''))}
                    placeholder="Unlimited"
                    inputMode="numeric"
                  />
                </div>
                <label className="flex items-start gap-2 sm:col-span-2">
                  <Checkbox
                    checked={autoApprove}
                    onCheckedChange={(value) => setAutoApprove(value === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    Approve automatically
                    <span className="block text-xs text-muted-foreground">
                      Leave this off for a pilot: each new PC then waits as <em>Awaiting approval</em>
                      {' '}until somebody approves it here, which is a second gate on a leaked code.
                    </span>
                  </span>
                </label>
              </CardContent>
            </Card>
          ) : null}

          {codes.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={codes.data ?? []}
              dense
              columns={[
                { header: 'Code', mobile: 'title', cell: (row) => <span className="font-mono">{row.id}</span> },
                { header: 'Label', mobile: 'detail', cell: (row) => row.label },
                {
                  header: 'Approval',
                  mobile: 'detail',
                  cell: (row) => (row.autoApprove ? 'Automatic' : 'Manual'),
                },
                {
                  header: 'Used',
                  align: 'right',
                  mobile: 'detail',
                  cell: (row) =>
                    `${row.registrationCount}${row.maxRegistrations ? ' / ' + row.maxRegistrations : ''}`,
                },
                {
                  header: '',
                  align: 'right',
                  mobile: 'footer',
                  cell: (row) =>
                    canManage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={async () => {
                          await run(row.enabled ? 'Code disabled' : 'Code enabled', () =>
                            setEnrollmentCodeEnabled(actor, row, !row.enabled),
                          );
                          codes.refresh();
                        }}
                      >
                        {row.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    ) : (
                      <StatusBadge status={row.enabled ? 'Enabled' : 'Disabled'} />
                    ),
                },
              ]}
              empty={<HrEmptyState title="No enrolment codes" description="Create one to start enrolling computers." />}
            />
          )}
        </div>

        <DialogFooter className={hrDialog.footer}>
          {canManage ? (
            <Button onClick={create} disabled={pending || !code.trim()}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Create code
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * One device (§34)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const { viewer, actor, directory, loading } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const router = useRouter();
  const now = useTickingNow(30_000);

  const allowed = canViewDevices(viewer);
  const device = useWindowsAgentQuery(
    'Loading device',
    () => fetchDevice(deviceId),
    [deviceId],
    { enabled: allowed && !loading },
  );

  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    destructive?: boolean;
    action: (reason: string) => Promise<void>;
  }>(null);
  const [reason, setReason] = useState('');
  const [maintenanceAccount, setMaintenanceAccount] = useState('none');
  const [securityOpen, setSecurityOpen] = useState(false);

  if (loading || device.loading) return <HrLoader label="Loading device" />;
  if (!allowed) return <HrAccessDenied what="this device" />;
  if (!device.data) {
    return <HrEmptyState title="Device not found" description="It may have been removed from the register." />;
  }

  const record: WindowsDevice = device.data;
  const canEdit = canManageDevices(viewer);
  const maintenanceActive = record.maintenanceAccess?.status === 'ACTIVE'
    && Date.parse(record.maintenanceAccess.expiresAt) > now.getTime();
  const securityPolicy = resolveDeviceSecurityPolicy(record.securityPolicy);
  // Null when the PC has never reported, which is a different thing from a long silence: one is
  // a machine nobody has installed the agent on, the other is a machine that has stopped talking.
  const heartbeatAge = record.lastHeartbeatAt
    ? Math.max(0, now.getTime() - Date.parse(record.lastHeartbeatAt))
    : null;
  const findingCount = record.securityPosture?.findings?.length ?? 0;

  /** What the folded security card says about itself, so it need not be opened to be read. */
  const securitySummary: { text: string; tone: 'success' | 'warning' | 'neutral' } = !record.securityPosture
    ? { text: 'No report yet', tone: 'neutral' }
    : findingCount === 0
      ? { text: 'Compliant', tone: 'success' }
      : {
        text: `${findingCount} ${findingCount === 1 ? 'check' : 'checks'} failing`,
        tone: 'warning',
      };
  const enforcedControlCount = SECURITY_CONTROL_ROWS.filter((control) => {
    const stored = securityPolicy[control.key];
    return control.inverted ? !stored : stored;
  }).length;

  const ask = (
    title: string,
    body: string,
    action: (reason: string) => Promise<void>,
    destructive = false,
  ) => {
    setReason('');
    setConfirm({ title, body, action, destructive });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={record.deviceName}
        description={`${record.facts?.hostname ?? ''} · ${record.facts?.windowsVersion ?? 'Unknown Windows'}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push(WINDOWS_AGENT_ROUTES.devices)}>
            Back to devices
          </Button>
        }
      />

      {/*
        The four things somebody opening this page came to find out.

        They were all present before — as four of seventeen identically-weighted label/value pairs,
        between the machine GUID and the credential version. "Is this PC online and is anybody
        locked out of it" should not require reading a table.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKpiCard
          label="Connection"
          value={heartbeatAge === null ? 'Never' : heartbeatAge < 300_000 ? 'Online' : 'Quiet'}
          hint={
            record.lastHeartbeatAt
              ? `Last heartbeat ${relativeLabel(record.lastHeartbeatAt, now)}`
              : 'This PC has never reported in'
          }
          tone={heartbeatAge === null ? 'slate' : heartbeatAge < 300_000 ? 'emerald' : 'amber'}
        />
        <HrKpiCard
          label="Register status"
          value={STATUS_WORDS[record.status] ?? record.status}
          hint={record.statusReason ?? 'Set by an administrator'}
          tone={record.status === 'ACTIVE' ? 'emerald' : record.status === 'PENDING' ? 'amber' : 'rose'}
        />
        <HrKpiCard
          label="Last signed in"
          value={record.lastSeenUserName ?? 'Nobody yet'}
          hint={record.lastLoginAt ? relativeLabel(record.lastLoginAt, now) : 'No work session on record'}
          tone="slate"
        />
        <HrKpiCard
          label="Security"
          value={
            !record.securityPosture
              ? 'No report'
              : findingCount === 0
                ? 'Compliant'
                : `${findingCount} failing`
          }
          hint={
            !record.securityPosture
              ? 'Needs agent 1.4 or newer'
              : findingCount === 0
                ? 'Matches the assigned policy'
                : securityPolicy.loginBlockedOnFindings
                  ? 'Sign-in is refused on this PC'
                  : 'Reported only — nobody is locked out'
          }
          tone={!record.securityPosture ? 'slate' : findingCount === 0 ? 'emerald' : 'amber'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Machine</CardTitle>
            <CardDescription>
              Reported by the agent at every start-up, and never editable from the PC itself.
            </CardDescription>
          </CardHeader>
          {/*
            Grouped, because seventeen facts in one flat grid gave a serial number the same weight
            as the status. Assignment is what an administrator changes, hardware is what they
            check against an asset register, and identity is what support quotes on a call.
          */}
          <CardContent className="space-y-4">
            <FactGroup title="Assignment">
              <Fact label="Status" value={<DeviceStatusBadge status={record.status} />} />
              <Fact label="Department" value={record.departmentName ?? '—'} />
              <Fact label="Location" value={record.assignedLocation ?? '—'} />
              <Fact label="Update ring" value={RING_WORDS[record.updateRing] ?? record.updateRing} />
              {record.statusReason ? (
                <Fact label="Status note" value={record.statusReason} className="sm:col-span-2" />
              ) : null}
            </FactGroup>

            <FactGroup title="Windows and hardware">
              <Fact label="Windows" value={record.facts?.windowsVersion ?? '—'} />
              <Fact label="Architecture" value={record.facts?.architecture ?? '—'} />
              <Fact label="Manufacturer" value={record.facts?.manufacturer ?? '—'} />
              <Fact label="Model" value={record.facts?.model ?? '—'} />
              <Fact label="Agent version" value={record.agentVersion ?? '—'} />
              <Fact label="Time zone" value={record.facts?.timeZoneId ?? '—'} />
            </FactGroup>

            <FactGroup title="Connection">
              <Fact label="Last heartbeat" value={<RelativeTime value={record.lastHeartbeatAt} now={now} />} />
              <Fact label="Last sign-in" value={<ClockTime value={record.lastLoginAt} />} />
              <Fact label="Last user" value={record.lastSeenUserName ?? '—'} />
              <Fact label="IP address" value={record.ipAddress ?? '—'} />
            </FactGroup>

            <FactGroup title="Identity">
              <Fact label="Hostname" value={<span className="font-mono text-xs">{record.facts?.hostname ?? '—'}</span>} />
              <Fact label="Serial" value={<span className="font-mono text-xs">{record.facts?.serialNumber ?? '—'}</span>} />
              <Fact
                label="Machine GUID"
                value={<span className="break-all font-mono text-xs">{record.facts?.machineGuid ?? '—'}</span>}
              />
              <Fact label="Enrolled" value={<ClockTime value={record.firstRegisteredAt} />} />
              <Fact label="Enrolment code" value={record.enrollmentCode ?? '—'} />
              <Fact label="Credential version" value={String(record.secretVersion ?? 1)} />
            </FactGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Each takes effect at the agent’s next heartbeat — within about 90 seconds. None of
              them can lock anybody out of Windows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {record.status === 'PENDING' && canEdit ? (
              <ActionButton
                icon={CheckCircle2}
                label="Approve this computer"
                disabled={pending}
                onClick={() =>
                  ask('Approve this computer?', 'The agent will be able to open work sessions.', (note) =>
                    setDeviceStatus(actor, record, 'ACTIVE', note || null).then(device.refresh),
                  )
                }
              />
            ) : null}

            {canSignOutUser(viewer) ? (
              <ActionButton
                icon={LogOut}
                label="Sign the current user out"
                disabled={pending}
                onClick={() =>
                  ask(
                    'Sign the current user out?',
                    'Their work session is closed properly and the sign-in screen appears. Their unsaved work in other applications is untouched.',
                    (note) => requestDeviceAction(actor, record, 'FORCE_SIGNOUT', note || null).then(device.refresh),
                  )
                }
              />
            ) : null}

            {canForceReauth(viewer) ? (
              <ActionButton
                icon={RotateCcw}
                label="Force re-authentication"
                disabled={pending}
                onClick={() =>
                  ask(
                    'Force re-authentication?',
                    'The agent drops its cached sign-in and asks for a password again. Use this when somebody has left, or a shared PC has changed hands.',
                    (note) => requestDeviceAction(actor, record, 'FORCE_REAUTH', note || null).then(device.refresh),
                  )
                }
              />
            ) : null}

            {canBlockDevice(viewer) ? (
              record.status === 'BLOCKED' ? (
                <ActionButton
                  icon={CheckCircle2}
                  label="Unblock this computer"
                  disabled={pending}
                  onClick={() =>
                    ask('Unblock this computer?', 'The agent can authenticate again.', (note) =>
                      setDeviceStatus(actor, record, 'ACTIVE', note || null).then(device.refresh),
                    )
                  }
                />
              ) : (
                <ActionButton
                  icon={Ban}
                  label="Block this computer"
                  destructive
                  disabled={pending}
                  onClick={() =>
                    ask(
                      'Block this computer?',
                      'The agent stops being able to open sessions, upload activity or fetch notifications. Anybody using the PC keeps working normally — this blocks SEL LIVE, not Windows.',
                      (note) => setDeviceStatus(actor, record, 'BLOCKED', note || null).then(device.refresh),
                      true,
                    )
                  }
                />
              )
            ) : null}

            {/*
              A divider, because the two halves of this card are different kinds of thing. Above,
              buttons that do something once and are written to the audit log. Below, settings
              that stay as you leave them. They were one undifferentiated stack, so the update
              ring looked like something you press.
            */}
            {canEdit ? (
              <div className="space-y-1.5 border-t pt-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Update ring
                </Label>
                <Select
                  value={record.updateRing}
                  onValueChange={(value) =>
                    run('Update ring changed', () =>
                      setDeviceUpdateRing(actor, record, value as WindowsDevice['updateRing']).then(device.refresh),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PILOT">Pilot — first to get new builds</SelectItem>
                    <SelectItem value="EARLY">Early</SelectItem>
                    <SelectItem value="BROAD">Broad — the default</SelectItem>
                    <SelectItem value="HELD">Held — no automatic updates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {canEdit ? (
              <p className="border-t pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Maintenance
              </p>
            ) : null}

            {canEdit ? (
              maintenanceActive ? (
                <ActionButton
                  icon={ShieldCheck}
                  label="End maintenance access"
                  disabled={pending}
                  onClick={() =>
                    ask(
                      'End maintenance access?',
                      'Task Manager will be locked again at the service’s next security sync. The revocation and reason are written to the audit log.',
                      (note) => changeDeviceMaintenanceAccess({
                        deviceId: record.id,
                        action: 'REVOKE',
                        reason: note,
                      }).then(device.refresh),
                    )
                  }
                />
              ) : (
                <ActionButton
                  icon={Wrench}
                  label="Open 30-minute maintenance"
                  disabled={pending}
                  onClick={() =>
                    ask(
                      'Open temporary maintenance access?',
                      'SEL LIVE will temporarily unlock Task Manager on this PC for 30 minutes. Service modification and uninstall stay blocked; the device re-locks from its own clock even if it goes offline.',
                      (note) => changeDeviceMaintenanceAccess({
                        deviceId: record.id,
                        action: 'GRANT',
                        durationMinutes: 30,
                        windowsAccount: maintenanceAccount === 'none' ? null : maintenanceAccount,
                        reason: note,
                      }).then(device.refresh),
                    )
                  }
                />
              )
            ) : null}
            {canEdit && !maintenanceActive && (record.securityPosture?.windowsAccounts?.length ?? 0) > 0 ? (
              <div className="space-y-1.5 pt-2">
                <Label className="text-xs">Temporary local admin (optional)</Label>
                <Select value={maintenanceAccount} onValueChange={setMaintenanceAccount}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None — Task Manager only</SelectItem>
                    {(record.securityPosture?.windowsAccounts ?? []).map((account) => (
                      <SelectItem key={account} value={account}>{account}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  SEL LIVE adds this loaded Windows account to local Administrators only until the maintenance window expires. No password is created or stored.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/*
        Folded away by default.

        Ten controls and their reported states are the longest thing on this page, and they are
        not what most visits are for — somebody opens a device to see whether it is online, who
        used it, or to sign a user out. The header carries the summary, so the state is legible
        without expanding: a device whose checks are failing says so on the closed card.
      */}
      <Collapsible open={securityOpen} onOpenChange={setSecurityOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-start gap-3 p-[var(--card-pad,1.5rem)] text-left"
              aria-expanded={securityOpen}
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold leading-none">Device security</span>
                  <StatusBadge
                    status={securitySummary.text}
                    tone={securitySummary.tone}
                  >
                    {securitySummary.text}
                  </StatusBadge>
                </span>
                <span className="mt-1.5 block text-sm text-muted-foreground">
                  {securityOpen
                    ? 'The tick is what SEL LIVE asks for; the badge is what the PC reported at its last check.'
                    : `${enforcedControlCount} of ${SECURITY_CONTROL_ROWS.length} controls are enforced on this computer. Open to review or change them.`}
                </span>
              </span>
              <ChevronDown
                className={cn('mt-0.5 h-4 w-4 shrink-0 transition-transform', securityOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-3 pt-0">
              <DeviceSecurityControls
                key={JSON.stringify(securityPolicy)}
                device={record}
                initialPolicy={securityPolicy}
                posture={record.securityPosture}
                maintenanceActive={maintenanceActive}
                canEdit={canEdit}
                onChanged={device.refresh}
              />

              {record.securityPosture?.findings?.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p className="text-sm font-medium">
                    {securityPolicy.loginBlockedOnFindings
                      ? 'Nobody can sign in on this computer until these are fixed'
                      : 'Reported, and nobody is locked out'}
                  </p>
                  {/*
                    Sentences, not codes. This printed `AGENT_BINARY_UNSIGNED · SECURE_BOOT_OFF`
                    under a heading saying attention was required, which tells whoever has to act
                    neither what is wrong nor whether it is their doing — and two of these are
                    expected states rather than faults.
                  */}
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {record.securityPosture.findings.map((finding) => (
                      <li key={finding} className="flex gap-1.5">
                        <span aria-hidden>•</span>
                        <span>{describeSecurityFinding(finding)}</span>
                      </li>
                    ))}
                  </ul>
                  {securityPolicy.loginBlockedOnFindings ? (
                    <p className="mt-2 text-xs">
                      Switch off <strong>Refuse sign-in when checks fail</strong> above to let people
                      work while these are dealt with.
                    </p>
                  ) : null}
                </div>
              ) : record.lastSecurityCheckAt ? (
                <p className="text-xs text-muted-foreground">
                  Last checked <RelativeTime value={record.lastSecurityCheckAt} now={now} />. Nothing
                  has drifted from the policy above.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Awaiting the first security report from the LocalSystem service. Agents older than
                  1.4 cannot produce one, so the badges stay at “no report yet” until this PC is
                  updated — and nobody is locked out in the meantime.
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                The append-only audit log is always mandatory and cannot be switched off from here.
              </p>
            </CardContent>
          </CollapsibleContent>

          {/*
            Outside the fold on purpose: an open maintenance window is a temporary hole in the
            lockdown with a clock on it, and the one thing on this card that must not be a click
            away from being noticed.
          */}
          {maintenanceActive && record.maintenanceAccess ? (
            <div className="mx-[var(--card-pad,1.5rem)] mb-[var(--card-pad,1.5rem)] rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-medium">Temporary maintenance access is active</p>
              <p className="mt-1 text-xs">
                Task Manager is available until <ClockTime value={record.maintenanceAccess.expiresAt} />.
                {' '}Approved by {record.maintenanceAccess.grantedByName}: {record.maintenanceAccess.reason}
                {record.maintenanceAccess.temporaryLocalAdmin && record.maintenanceAccess.windowsAccount
                  ? ` Temporary local admin: ${record.maintenanceAccess.windowsAccount}.`
                  : ''}
              </p>
            </div>
          ) : null}
        </Card>
      </Collapsible>

      {canAssignDeviceUsers(viewer) ? (
        <AssignedUsersCard device={record} onChanged={device.refresh} directory={directory} />
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="wa-reason">Reason (recorded in the audit log)</Label>
            <Textarea
              id="wa-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are you doing this?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.destructive ? 'destructive' : 'default'}
              disabled={pending || (confirm?.title.toLowerCase().includes('maintenance') && !reason.trim())}
              onClick={async () => {
                const pendingAction = confirm;
                setConfirm(null);
                if (pendingAction) await run(pendingAction.title, () => pendingAction.action(reason));
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Who may sign in on this PC, with enough about each person to know who they are.
 *
 * ── Why a bare name is not enough ─────────────────────────────────────────────────────────────
 *
 * This was a scrolling list of two hundred names with a department occasionally beside one. A
 * fleet has three people called the same thing, and an administrator assigning a site PC has no
 * way to tell which "Rajesh Kumar" is the storekeeper at Bhubaneswar. So each row now carries the
 * employee code HR uses, the job title and the posting location — joined on from the HR records
 * by `people-directory`, which is where those facts are maintained.
 *
 * The people already assigned are listed first, and stay listed while a search is running. Before
 * this, saving an assignment and then typing a name hid the very rows that were about to be
 * changed, and "who can use this PC?" could only be answered by scrolling the whole directory
 * looking for ticks.
 */
function AssignedUsersCard({
  device,
  directory,
  onChanged,
}: {
  device: WindowsDevice;
  directory: DirectoryEntry[];
  onChanged: () => void;
}) {
  const { actor } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const [selected, setSelected] = useState<string[]>(device.assignedUserIds ?? []);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matches = (person: DirectoryEntry) =>
      !needle
      || [person.name, person.employeeNo, person.designation, person.location, person.departmentName, person.email]
        .some((field) => String(field ?? '').toLowerCase().includes(needle));

    // Chosen people first, and never filtered out: they are the ones being changed.
    const chosen = directory.filter((person) => selected.includes(person.id));
    const rest = directory.filter((person) => !selected.includes(person.id) && matches(person));
    return [...chosen, ...rest.slice(0, 200)];
  }, [directory, filter, selected]);

  const dirty =
    selected.length !== (device.assignedUserIds ?? []).length ||
    selected.some((id) => !(device.assignedUserIds ?? []).includes(id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Who may sign in here</CardTitle>
        <CardDescription>
          Leave this empty for a shared computer — anybody with an active SEL LIVE account can then
          use it. Naming people makes the machine personal: everybody else is refused at sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Search by name, employee code, designation or location"
          className="max-w-md"
        />
        <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {visible.map((person) => {
            const chosen = selected.includes(person.id);
            // Designation, then the two places a person sits. Joined with a middle dot rather
            // than laid out in columns: a title can be forty characters and a column grid for it
            // either truncates it or leaves half the row empty.
            const detail = [person.designation, person.department ?? person.departmentName, person.location]
              .filter((part) => Boolean(part))
              .join(' · ');

            return (
              <label
                key={person.id}
                className={cn('flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/60', chosen && 'bg-primary/5')}
              >
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={chosen}
                  onCheckedChange={(value) =>
                    setSelected((current) =>
                      value === true ? [...current, person.id] : current.filter((id) => id !== person.id),
                    )
                  }
                  aria-label={person.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{person.name}</span>
                    {person.employeeNo ? (
                      <span className="font-mono text-xs text-muted-foreground">{person.employeeNo}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {detail || person.email || 'No HR record joined'}
                  </span>
                </span>
              </label>
            );
          })}
          {visible.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Nobody matches “{filter}”. Search by name, employee code, designation or location.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={async () => {
              await run('Assignment saved', () => setDeviceAssignment(actor, device, selected));
              onChanged();
            }}
          >
            Save assignment
          </Button>
          {selected.length === 0 ? (
            <span className="text-xs text-muted-foreground">Shared computer — nobody is refused.</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {selected.length} {selected.length === 1 ? 'person' : 'people'} may sign in.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What the PC reports about one control, phrased for the person reading it.
 *
 * `ok` drives the badge tone, and `neutral` separates "nothing to worry about" from "this is
 * good": a control switched off on purpose must not look like a passing check, or a page full of
 * green says the machine is locked down when nothing is enforced at all.
 */
type ControlState = { text: string; ok?: boolean; neutral?: boolean };

type SecurityControl = {
  key: Exclude<keyof WindowsDeviceSecurityPolicy, 'enforcementIntervalSeconds' | 'auditRequired'>;
  label: string;
  description: string;
  inverted?: boolean;
  /**
   * How this control stands on this PC right now.
   *
   * Every control has one, including the few Windows cannot measure — "enforced by the installer"
   * is a truthful answer and an empty cell is not. Before this, the page showed the assigned
   * policy in one grid and the measured posture in another, in two visual languages, so the two
   * questions an administrator actually has — what did we ask for, and did it happen — had to be
   * answered by reading two lists and matching the labels up by eye.
   */
  state: (input: {
    policy: WindowsDeviceSecurityPolicy;
    posture: WindowsDeviceSecurityPosture | null | undefined;
    maintenanceActive: boolean;
  }) => ControlState;
};

/** "On, and the PC agrees" / "On, and it has not happened" / "No report yet". */
function reportedFlag(
  enforced: boolean,
  measured: boolean | null | undefined,
  labels: { yes: string; no: string },
): ControlState {
  if (!enforced) return { text: 'Not enforced', neutral: true };
  if (measured === true) return { text: labels.yes, ok: true };
  if (measured === false) return { text: labels.no, ok: false };
  return { text: 'No report yet', neutral: true };
}

const SECURITY_CONTROL_ROWS: SecurityControl[] = [
  {
    key: 'loginBlockedOnFindings',
    label: 'Refuse sign-in when checks fail',
    // First in the list because it decides what all the others below it *do*. Off by default:
    // with it on and the strict baseline, a sign-in needs signed agent binaries — and the agent
    // is not code-signed yet, so switching this on before a device reports clean locks the
    // people who use it out of their own computer.
    description: 'Off by default. Until this is on, failed checks are reported here and nobody is locked out.',
    state: ({ policy, posture }) => {
      if (!policy.loginBlockedOnFindings) return { text: 'Reporting only', neutral: true };
      const failing = posture?.findings?.length ?? 0;
      return failing > 0
        ? { text: 'Sign-in refused now', ok: false }
        : { text: 'Refused if a check fails', ok: true };
    },
  },
  {
    key: 'taskManagerLocked',
    label: 'Lock Task Manager',
    description: 'Prevents local users opening Task Manager.',
    state: ({ policy, posture, maintenanceActive }) => {
      if (!policy.taskManagerLocked) return { text: 'Not enforced', neutral: true };
      if (maintenanceActive) return { text: 'Temporarily open', ok: false };
      return reportedFlag(true, posture?.taskManagerLocked, { yes: 'Locked', no: 'Not locked' });
    },
  },
  {
    key: 'agentStopBlocked',
    label: 'Block SEL Agent service stop',
    description: 'Removes the administrator SERVICE_STOP right.',
    state: ({ policy, posture }) =>
      reportedFlag(policy.agentStopBlocked, posture?.agentStopBlocked, { yes: 'Blocked', no: 'Can be stopped' }),
  },
  {
    key: 'serviceModificationBlocked',
    label: 'Block service modification',
    description: 'Prevents reconfiguration, deletion and service ACL changes.',
    state: ({ policy, posture }) =>
      reportedFlag(policy.serviceModificationBlocked, posture?.serviceModificationBlocked, {
        yes: 'Blocked',
        no: 'Can be changed',
      }),
  },
  {
    key: 'uninstallBlocked',
    label: 'Block agent uninstall',
    description: 'Requires SEL LIVE approval before removal.',
    // Enforced by the installer at the moment somebody tries it, so there is nothing for the
    // service to measure between attempts. Saying where it is enforced beats an empty cell.
    state: ({ policy }) => policy.uninstallBlocked
      ? { text: 'Approval needed', ok: true }
      : { text: 'Not enforced', neutral: true },
  },
  {
    key: 'monitoringPolicyLocallyMutable',
    label: 'Block local monitoring-policy changes',
    description: 'Keeps monitoring configuration server-only.',
    inverted: true,
    state: ({ policy }) => policy.monitoringPolicyLocallyMutable
      ? { text: 'Local changes allowed', neutral: true }
      : { text: 'Server only', ok: true },
  },
  {
    key: 'signedAgentBinariesRequired',
    label: 'Require signed agent binaries',
    description: 'Unsigned installed agent files make the device non-compliant.',
    state: ({ policy, posture }) =>
      reportedFlag(policy.signedAgentBinariesRequired, posture?.agentBinariesSigned, {
        yes: 'Signed',
        no: 'Unsigned',
      }),
  },
  {
    key: 'signedAppControlPolicyRequired',
    label: 'Require signed app-control policy',
    description: 'Requires an enforced signed WDAC policy.',
    state: ({ policy, posture }) =>
      reportedFlag(policy.signedAppControlPolicyRequired, posture?.signedAppControlPolicyActive, {
        yes: 'Active',
        no: 'Not active',
      }),
  },
  {
    key: 'secureBootRequired',
    label: 'Require Secure Boot',
    description: 'Reports the device non-compliant when Secure Boot is off or unreadable.',
    state: ({ policy, posture }) => {
      if (!policy.secureBootRequired) return { text: 'Not enforced', neutral: true };
      if (posture?.secureBootEnabled === true) return { text: 'On', ok: true };
      if (posture?.secureBootEnabled === false) return { text: 'Off in firmware', ok: false };
      // Null is genuinely different from false: a legacy-boot PC cannot report the flag at all.
      return posture ? { text: 'Unreadable', ok: false } : { text: 'No report yet', neutral: true };
    },
  },
  {
    key: 'tamperMonitoringEnabled',
    label: 'Monitor tamper events',
    description: 'Writes drift and restoration events to the audit trail.',
    state: ({ policy }) => policy.tamperMonitoringEnabled
      ? { text: 'Audited', ok: true }
      : { text: 'Not monitored', neutral: true },
  },
];

/**
 * The security controls: what was asked for, and what the PC says came of it.
 *
 * ── One list, because they are one question ───────────────────────────────────────────────────
 *
 * This used to be two blocks stacked on top of each other — a grid of ten checkboxes for the
 * policy, then a grid of ten badges for the posture — with the same ten controls in a different
 * order and different words in each. Reading it meant matching label to label by eye to find out
 * whether "Require Secure Boot" had actually taken effect, and the two grids disagreed about how
 * to say the same thing ("SIGNED" against "Require signed agent binaries").
 *
 * Merged, each row carries the switch and the answer, so the page is scannable down one column:
 * anything not green is either deliberately off or not happening.
 */
function DeviceSecurityControls({
  device,
  initialPolicy,
  posture,
  maintenanceActive,
  canEdit,
  onChanged,
}: {
  device: WindowsDevice;
  initialPolicy: WindowsDeviceSecurityPolicy;
  posture: WindowsDeviceSecurityPosture | null | undefined;
  maintenanceActive: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { run, pending } = useWindowsAgentAction();
  const [policy, setPolicy] = useState(initialPolicy);
  const [reason, setReason] = useState('');
  const dirty = JSON.stringify(policy) !== JSON.stringify(initialPolicy);

  return (
    <div className="space-y-3">
      <div className="divide-y overflow-hidden rounded-lg border">
        {SECURITY_CONTROL_ROWS.map((control) => {
          const stored = policy[control.key];
          const enabled = control.inverted ? !stored : stored;
          // Reported against the *saved* policy, not the unsaved switches: a switch flipped a
          // second ago has not reached the PC, and showing it as though it had would be the one
          // lie this page cannot afford.
          const state = control.state({ policy: initialPolicy, posture, maintenanceActive });

          return (
            <div key={control.key} className="flex items-start gap-3 p-3">
              <Checkbox
                className="mt-0.5 shrink-0"
                checked={enabled}
                onCheckedChange={(checked) => {
                  const next = checked === true;
                  setPolicy((current) => ({
                    ...current,
                    [control.key]: control.inverted ? !next : next,
                  }));
                }}
                disabled={pending || !canEdit}
                aria-label={control.label}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium leading-none">{control.label}</p>
                  <StatusBadge
                    status={state.text}
                    tone={state.neutral ? 'neutral' : state.ok ? 'success' : 'warning'}
                  >
                    {state.text}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{control.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {canEdit ? (
        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`security-policy-reason-${device.id}`} className="text-xs">
              Reason for this change
            </Label>
            <Input
              id={`security-policy-reason-${device.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Required for the audit log"
              disabled={pending}
            />
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setPolicy({ ...WINDOWS_DEVICE_SECURITY_POLICY })}
          >
            Strict baseline
          </Button>
          <Button
            disabled={pending || !dirty || !reason.trim()}
            onClick={() => run('Device security policy updated', async () => {
              await changeDeviceSecurityPolicy({ deviceId: device.id, policy, reason: reason.trim() });
              setReason('');
              await onChanged();
            })}
          >
            {dirty ? 'Save controls' : 'Saved'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Register statuses as words, rather than the stored constant. */
const STATUS_WORDS: Record<string, string> = {
  PENDING: 'Awaiting approval',
  ACTIVE: 'Active',
  BLOCKED: 'Blocked',
  DISABLED: 'Disabled',
  MAINTENANCE: 'Maintenance',
  RETIRED: 'Retired',
};

const RING_WORDS: Record<string, string> = {
  PILOT: 'Pilot — first to update',
  EARLY: 'Early',
  BROAD: 'Broad — the default',
  HELD: 'Held — no auto-updates',
};

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

/**
 * A titled block of facts.
 *
 * `grid-cols-1` before the `sm:` breakpoint on purpose: a two-column grid with no base count
 * stretches to whatever its widest cell needs, and a machine GUID is wide enough to push a phone
 * into a horizontal scroll.
 */
function FactGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{title}</p>
      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Button
      variant={destructive ? 'destructive' : 'outline'}
      size="sm"
      className="w-full justify-start"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="mr-2 h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
