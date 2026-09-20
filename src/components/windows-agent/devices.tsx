'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, HardDrive, KeyRound, LogOut, Plus, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  HrPageHeader,
  hrDialog,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { WINDOWS_AGENT_ROUTES, evaluateAgentHealth, type WindowsDevice } from '@/lib/windows-agent';
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
  fetchDevice,
  fetchDevices,
  fetchEnrollmentCodes,
  requestDeviceAction,
  setDeviceAssignment,
  setDeviceStatus,
  setDeviceUpdateRing,
  setEnrollmentCodeEnabled,
} from '@/lib/windows-agent-service';
import { useTickingNow, useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';
import { ClockTime, DeviceStatusBadge, RelativeTime } from './ui';

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
            <Badge key={flag} variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
              {flag.replace(/_/g, ' ').toLowerCase()}
            </Badge>
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
      <HrPageHeader
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{rows.length} of {counts.total}</CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name, hostname, department or user"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          {devices.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              columns={columns}
              dense
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
        </CardContent>
      </Card>

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
                { header: 'Code', mobile: 'title', cell: (row) => <span className="font-mono text-sm">{row.id}</span> },
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
                      <Badge variant="outline">{row.enabled ? 'Enabled' : 'Disabled'}</Badge>
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

  if (loading || device.loading) return <HrLoader label="Loading device" />;
  if (!allowed) return <HrAccessDenied what="this device" />;
  if (!device.data) {
    return <HrEmptyState title="Device not found" description="It may have been removed from the register." />;
  }

  const record: WindowsDevice = device.data;
  const canEdit = canManageDevices(viewer);

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
      <HrPageHeader
        title={record.deviceName}
        description={`${record.facts?.hostname ?? ''} · ${record.facts?.windowsVersion ?? 'Unknown Windows'}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push(WINDOWS_AGENT_ROUTES.devices)}>
            Back to devices
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Machine</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Status" value={<DeviceStatusBadge status={record.status} />} />
            <Fact label="Department" value={record.departmentName ?? '—'} />
            <Fact label="Location" value={record.assignedLocation ?? '—'} />
            <Fact label="Agent version" value={record.agentVersion ?? '—'} />
            <Fact label="Update ring" value={record.updateRing} />
            <Fact label="Architecture" value={record.facts?.architecture ?? '—'} />
            <Fact label="Manufacturer" value={record.facts?.manufacturer ?? '—'} />
            <Fact label="Model" value={record.facts?.model ?? '—'} />
            <Fact label="Serial" value={record.facts?.serialNumber ?? '—'} />
            <Fact label="Machine GUID" value={<span className="font-mono text-xs">{record.facts?.machineGuid ?? '—'}</span>} />
            <Fact label="Enrolled" value={<ClockTime value={record.firstRegisteredAt} />} />
            <Fact label="Credential version" value={String(record.secretVersion ?? 1)} />
            <Fact label="Last heartbeat" value={<RelativeTime value={record.lastHeartbeatAt} now={now} />} />
            <Fact label="Last sign-in" value={<ClockTime value={record.lastLoginAt} />} />
            <Fact label="Last user" value={record.lastSeenUserName ?? '—'} />
            <Fact label="IP address" value={record.ipAddress ?? '—'} />
            {record.statusReason ? (
              <Fact label="Status note" value={record.statusReason} className="sm:col-span-2" />
            ) : null}
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

            {canEdit ? (
              <div className="space-y-1.5 pt-2">
                <Label className="text-xs">Update ring</Label>
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
          </CardContent>
        </Card>
      </div>

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
              disabled={pending}
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

function AssignedUsersCard({
  device,
  directory,
  onChanged,
}: {
  device: WindowsDevice;
  directory: { id: string; name: string; departmentName: string | null }[];
  onChanged: () => void;
}) {
  const { actor } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();
  const [selected, setSelected] = useState<string[]>(device.assignedUserIds ?? []);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return directory
      .filter((person) => (needle ? person.name.toLowerCase().includes(needle) : true))
      .slice(0, 200);
  }, [directory, filter]);

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
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search people"
          className="max-w-sm"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {visible.map((person) => (
            <label key={person.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
              <Checkbox
                checked={selected.includes(person.id)}
                onCheckedChange={(value) =>
                  setSelected((current) =>
                    value === true ? [...current, person.id] : current.filter((id) => id !== person.id),
                  )
                }
              />
              <span className="text-sm">
                {person.name}
                {person.departmentName ? (
                  <span className="ml-2 text-xs text-muted-foreground">{person.departmentName}</span>
                ) : null}
              </span>
            </label>
          ))}
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
