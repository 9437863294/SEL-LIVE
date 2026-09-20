'use client';

import { useMemo, useState } from 'react';
import { Globe, Laptop, Search, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  WINDOWS_AGENT_ROUTES,
  devicesAvailableToUser,
  type WindowsDevice,
  type WindowsUserDeviceAccess,
} from '@/lib/windows-agent';
import { canAssignDeviceUsers, canViewDevices } from '@/lib/windows-agent-permissions';
import { fetchDevices, fetchUserDeviceAccess, setUserDeviceAccess } from '@/lib/windows-agent-service';
import { useWindowsAgent, useWindowsAgentAction, useWindowsAgentQuery } from './hooks';

/**
 * Computer access, seen from the person's side.
 *
 * The device page answers "who may use this PC". This answers "which PCs may this person use",
 * which is the question an administrator actually asks when somebody joins, changes team or
 * leaves — and it is not the same question viewed from the other end. A device-side list can
 * make a machine personal; only a user-side list can confine a person, because every PC they are
 * not named on is still shared.
 *
 * ── The number in the "Computers" column is derived, not stored ────────────────────────────────
 *
 * It is `devicesAvailableToUser` over the live fleet, so it changes when somebody makes an
 * unrelated machine personal — which is exactly when a stored count would silently go stale and
 * somebody would trust it.
 */
export function ComputerAccessPage() {
  const { viewer, directory, loading } = useWindowsAgent();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [restrictedOnly, setRestrictedOnly] = useState(false);

  const allowed = canViewDevices(viewer);
  const canEdit = canAssignDeviceUsers(viewer);

  const data = useWindowsAgentQuery(
    'Loading computer access',
    async () => {
      const [devices, access] = await Promise.all([fetchDevices(), fetchUserDeviceAccess()]);
      return { devices, access };
    },
    [],
    { enabled: allowed && !loading },
  );

  const rows = useMemo(() => {
    const devices = (data.data?.devices ?? []).filter(
      (device) => device.status === 'ACTIVE' || device.status === 'MAINTENANCE',
    );
    const accessById = new Map((data.data?.access ?? []).map((entry) => [entry.id, entry]));
    const needle = search.trim().toLowerCase();

    return directory
      .map((person) => {
        const restriction = accessById.get(person.id) ?? null;
        const available = devicesAvailableToUser(devices, restriction, person.id);
        return {
          id: person.id,
          name: person.name,
          departmentName: person.departmentName,
          restricted: Boolean(restriction?.allowedDeviceIds?.length),
          allowedDeviceIds: restriction?.allowedDeviceIds ?? [],
          reason: restriction?.reason ?? null,
          availableCount: available.length,
          availableNames: available.map((device) => device.deviceName),
          fleetSize: devices.length,
        };
      })
      .filter((row) => (restrictedOnly ? row.restricted : true))
      .filter((row) =>
        !needle
          ? true
          : row.name.toLowerCase().includes(needle) ||
            (row.departmentName ?? '').toLowerCase().includes(needle),
      );
  }, [data.data, directory, search, restrictedOnly]);

  const counts = useMemo(
    () => ({
      people: directory.length,
      restricted: (data.data?.access ?? []).filter((entry) => (entry.allowedDeviceIds ?? []).length > 0).length,
      fleet: (data.data?.devices ?? []).filter(
        (device) => device.status === 'ACTIVE' || device.status === 'MAINTENANCE',
      ).length,
      personalMachines: (data.data?.devices ?? []).filter((device) => (device.assignedUserIds ?? []).length > 0)
        .length,
    }),
    [data.data, directory],
  );

  if (loading) return <HrLoader label="Loading computer access" />;
  if (!allowed) return <HrAccessDenied what="computer access" />;

  type Row = (typeof rows)[number];

  const columns: HrListColumn<Row>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <span>
          <span className="block font-medium">{row.name}</span>
          {row.departmentName ? (
            <span className="block text-xs text-muted-foreground">{row.departmentName}</span>
          ) : null}
        </span>
      ),
    },
    {
      header: 'Access',
      mobile: 'aside',
      cell: (row) =>
        row.restricted ? (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            <Laptop className="mr-1 h-3 w-3" aria-hidden />
            Restricted
          </Badge>
        ) : (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <Globe className="mr-1 h-3 w-3" aria-hidden />
            Any computer
          </Badge>
        ),
    },
    {
      header: 'Computers',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (
        <span
          className="tabular-nums"
          title={row.availableNames.slice(0, 20).join('\n') || 'None'}
        >
          {row.availableCount}
          <span className="ml-1 text-xs text-muted-foreground">of {row.fleetSize}</span>
        </span>
      ),
    },
    {
      header: 'Reason',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) =>
        row.reason ? (
          <span className="text-xs text-muted-foreground">{row.reason}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (row) =>
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing({ id: row.id, name: row.name })}>
            {row.restricted ? 'Change' : 'Restrict'}
          </Button>
        ) : null,
    },
  ];

  const editingRow = editing ? rows.find((row) => row.id === editing.id) : null;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Computer access"
        description="Which computers each person may sign in on. Everybody can use any computer until you say otherwise."
        actions={
          <Button
            variant={restrictedOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRestrictedOnly((value) => !value)}
          >
            {restrictedOnly ? 'Showing restricted only' : 'Show restricted only'}
          </Button>
        }
      />

      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          <div className="text-blue-900">
            <p className="font-medium">Access is decided by two lists, and both have to allow it.</p>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              <li>
                <strong>This page</strong> — which computers a person may use. Empty means any.
              </li>
              <li>
                <strong>The device page</strong> — who may use a given computer. Empty means it is
                shared.
              </li>
            </ul>
            <p className="mt-1.5 text-xs">
              Leaving both empty is the default and means anybody can sign in anywhere. Use this
              page for contractors, site-specific staff, or anyone who should be tied to particular
              machines.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HrKpiCard label="People" value={counts.people} tone="blue" />
        <HrKpiCard
          label="Restricted to certain PCs"
          value={counts.restricted}
          tone={counts.restricted ? 'amber' : 'slate'}
        />
        <HrKpiCard label="Computers in service" value={counts.fleet} tone="indigo" href={WINDOWS_AGENT_ROUTES.devices} />
        <HrKpiCard
          label="Personal machines"
          value={counts.personalMachines}
          tone="slate"
          hint="PCs with a named user list"
          href={WINDOWS_AGENT_ROUTES.devices}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </CardTitle>
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by name or department"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {data.loading ? (
            <HrLoader />
          ) : (
            <HrDataList
              rows={rows}
              columns={columns}
              dense
              maxHeightClassName="sm:max-h-[40rem]"
              empty={
                <HrEmptyState
                  title={restrictedOnly ? 'Nobody is restricted' : 'No people found'}
                  description={
                    restrictedOnly
                      ? 'Everybody can sign in on any computer, which is the default.'
                      : 'The user directory is empty or still loading.'
                  }
                />
              }
            />
          )}
        </CardContent>
      </Card>

      {editing && editingRow ? (
        <AccessEditor
          person={editing}
          current={editingRow.allowedDeviceIds}
          currentReason={editingRow.reason}
          devices={data.data?.devices ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            data.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AccessEditor({
  person,
  current,
  currentReason,
  devices,
  onClose,
  onSaved,
}: {
  person: { id: string; name: string };
  current: string[];
  currentReason: string | null;
  devices: WindowsDevice[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { actor } = useWindowsAgent();
  const { run, pending } = useWindowsAgentAction();

  const [selected, setSelected] = useState<string[]>(current);
  const [reason, setReason] = useState(currentReason ?? '');
  const [filter, setFilter] = useState('');

  const inService = useMemo(
    () =>
      devices
        .filter((device) => device.status === 'ACTIVE' || device.status === 'MAINTENANCE')
        .filter((device) => {
          const needle = filter.trim().toLowerCase();
          return !needle
            ? true
            : device.deviceName.toLowerCase().includes(needle) ||
                (device.departmentName ?? '').toLowerCase().includes(needle) ||
                (device.assignedLocation ?? '').toLowerCase().includes(needle);
        })
        .sort((left, right) => left.deviceName.localeCompare(right.deviceName)),
    [devices, filter],
  );

  const unrestricted = selected.length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={hrDialog.contentTall}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>Computer access — {person.name}</DialogTitle>
          <DialogDescription>
            Tick the computers this person may sign in on. Leave everything unticked to let them
            use any computer, which is the default.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyScroll}>
          <div
            className={
              unrestricted
                ? 'rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900'
                : 'rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'
            }
          >
            {unrestricted ? (
              <>
                <strong>No restriction.</strong> {person.name} can sign in on any computer that is
                not itself reserved for other people.
              </>
            ) : (
              <>
                <strong>
                  Restricted to {selected.length} {selected.length === 1 ? 'computer' : 'computers'}.
                </strong>{' '}
                Signing in anywhere else will be refused, including on shared machines.
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search computers"
              className="max-w-sm"
            />
            {selected.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Clear — allow any computer
              </Button>
            ) : null}
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2">
            {inService.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No computers in service.</p>
            ) : (
              inService.map((device) => {
                const reservedForOthers =
                  (device.assignedUserIds ?? []).length > 0 &&
                  !(device.assignedUserIds ?? []).includes(person.id);
                return (
                  <label
                    key={device.id}
                    className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(device.id)}
                      onCheckedChange={(value) =>
                        setSelected((currentIds) =>
                          value === true
                            ? [...currentIds, device.id]
                            : currentIds.filter((id) => id !== device.id),
                        )
                      }
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">{device.deviceName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[device.departmentName, device.assignedLocation, device.facts?.hostname]
                          .filter(Boolean)
                          .join(' · ') || 'No department'}
                      </span>
                      {reservedForOthers ? (
                        // Worth saying rather than silently producing a selection that cannot
                        // work: both lists must allow a sign-in, so ticking this achieves nothing
                        // until the device page adds them too.
                        <span className="mt-0.5 block text-xs text-amber-700">
                          Reserved for other people — ticking this alone will not grant access.
                          Add {person.name} on the device page too.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-access-reason">Reason (recorded in the audit log)</Label>
            <Textarea
              id="wa-access-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Contractor — site office only"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const ok = await run('Computer access saved', () =>
                setUserDeviceAccess(actor, person, selected, reason.trim() || null),
              );
              if (ok) onSaved();
            }}
          >
            {unrestricted ? 'Allow any computer' : `Restrict to ${selected.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
