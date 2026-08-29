'use client';

/**
 * Access-control reports (§36) and their exports (§35).
 *
 * All eight reports are computed from the directory already in memory — no extra reads, no
 * server-side aggregation. That is affordable because the inputs are bounded by the number of users
 * and roles, and it means the reports cannot disagree with the screens next to them: the same
 * resolver produced both.
 *
 * Every report exports to a real .xlsx through the shared `report-excel` helper, so an access review
 * that has to be sent to an auditor leaves as a proper workbook rather than a screenshot.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  KeyRound,
  Layers,
  ShieldAlert,
  UserMinus,
  UserSearch,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HrDataList, HrEmptyState, type HrListColumn } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  expiringTemporaryGrants,
  formatGrantDate,
  temporaryGrantState,
  type RegistryNode,
} from '@/lib/access-control';
import { listAccessAuditEntries } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { AccessCard, RiskBadges, RoleBadge } from './access-ui';

export type ReportId =
  | 'user-access'
  | 'role-usage'
  | 'permission-usage'
  | 'privileged'
  | 'project-access'
  | 'temporary'
  | 'changes'
  | 'inactive';

const REPORTS: Array<{ id: ReportId; label: string; description: string; icon: React.ElementType }> = [
  { id: 'user-access', label: 'User access', description: 'Who has access to what.', icon: Users },
  { id: 'role-usage', label: 'Role usage', description: 'Which users hold each role.', icon: Layers },
  { id: 'permission-usage', label: 'Permission usage', description: 'Who holds a particular permission.', icon: KeyRound },
  { id: 'privileged', label: 'Privileged users', description: 'Users with high-risk permissions.', icon: ShieldAlert },
  { id: 'project-access', label: 'Project access', description: 'Users assigned to each project.', icon: UserSearch },
  { id: 'temporary', label: 'Temporary access', description: 'Current and expiring temporary grants.', icon: AlertTriangle },
  { id: 'changes', label: 'Access changes', description: 'Permissions changed in a date range.', icon: FileSpreadsheet },
  { id: 'inactive', label: 'Inactive users holding access', description: 'Deactivated employees who still hold permissions.', icon: UserMinus },
];

export function AccessReports({
  state,
  initialReport,
}: {
  state: AccessDirectoryState;
  /** Which report to open on. The Overview's alerts pass this so "Open the report" lands on the finding, not the default. */
  initialReport?: ReportId;
}) {
  const [selected, setSelected] = useState<ReportId>(initialReport ?? 'user-access');

  const report = REPORTS.find((entry) => entry.id === selected)!;

  return (
    <div className="space-y-3">
      {/* Eight tiles are a screen and a half on a phone before the report itself; a select is one
          row and names all eight at once. Same idiom as `ModulePicker`. */}
      <div className="sm:hidden">
        <Select value={selected} onValueChange={(value) => setSelected(value as ReportId)}>
          <SelectTrigger aria-label="Report" className="bg-white/85 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[70dvh]">
            {REPORTS.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        {REPORTS.map((entry) => {
          const Icon = entry.icon;
          const active = entry.id === selected;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? 'border-indigo-300 bg-indigo-50'
                  : 'border-white/70 bg-white/80 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800">{entry.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{entry.description}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <AccessCard>
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-sm">{report.label}</CardTitle>
          <CardDescription className="text-xs">{report.description}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {selected === 'user-access' && <UserAccessReport state={state} />}
          {selected === 'role-usage' && <RoleUsageReport state={state} />}
          {selected === 'permission-usage' && <PermissionUsageReport state={state} />}
          {selected === 'privileged' && <PrivilegedUsersReport state={state} />}
          {selected === 'project-access' && <ProjectAccessReport state={state} />}
          {selected === 'temporary' && <TemporaryAccessReport state={state} />}
          {selected === 'changes' && <AccessChangeReport state={state} />}
          {selected === 'inactive' && <InactiveUsersReport state={state} />}
        </CardContent>
      </AccessCard>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Shared export button
 * ---------------------------------------------------------------------------------------------- */

function ExportButton({
  title,
  rows,
  filename,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  filename: string;
}) {
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!rows.length}
      onClick={async () => {
        try {
          await exportRowsToExcel(title, rows, { filename });
        } catch (error) {
          toast({
            title: 'Export failed',
            description: error instanceof Error ? error.message : 'Unexpected error.',
            variant: 'destructive',
          });
        }
      }}
    >
      <Download className="mr-1.5 h-4 w-4" />
      Export ({rows.length})
    </Button>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 1. User access
 * ---------------------------------------------------------------------------------------------- */

function UserAccessReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser, projects } = state;

  const rows = useMemo(
    () =>
      directory.users
        .map((user) => {
          const access = accessByUser[user.id];
          return {
            id: user.id,
            user,
            access,
            baseRole: access?.baseRoleName ?? user.role ?? '',
            additionalRoles: access?.additionalRoleNames ?? [],
            permissionCount: access?.permissionCount ?? 0,
            modules: access?.modules ?? [],
            projectNames: (access?.projectIds ?? []).map(
              (id) => projects.find((project) => project.id === id)?.projectName ?? id,
            ),
          };
        })
        .sort((a, b) => b.permissionCount - a.permissionCount),
    [directory.users, accessByUser, projects],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'User', mobile: 'title', cell: (row) => row.user.name || row.user.email },
    { header: 'Base role', mobile: 'detail', cell: (row) => (row.baseRole ? <RoleBadge name={row.baseRole} kind="base" /> : '—') },
    {
      header: 'Additional roles',
      mobile: 'detail',
      cell: (row) =>
        row.additionalRoles.length ? (
          <span className="flex flex-wrap gap-1">
            {row.additionalRoles.slice(0, 3).map((name) => (
              <RoleBadge key={name} name={name} kind="additional" />
            ))}
            {row.additionalRoles.length > 3 && <span className="text-xs">+{row.additionalRoles.length - 3}</span>}
          </span>
        ) : (
          '—'
        ),
    },
    { header: 'Permissions', align: 'right', mobile: 'aside', cell: (row) => row.permissionCount },
    { header: 'Modules', mobile: 'detail', cell: (row) => row.modules.length },
    { header: 'Projects', className: 'hidden lg:table-cell', cell: (row) => row.projectNames.join(', ') || 'All' },
    { header: 'Status', mobile: 'aside', cell: (row) => row.user.status ?? 'Active' },
  ];

  const exportRows = rows.map((row) => ({
    User: row.user.name || row.user.email,
    Email: row.user.email,
    Status: row.user.status ?? 'Active',
    'Base role': row.baseRole,
    'Additional roles': row.additionalRoles.join(', '),
    'Effective permissions': row.permissionCount,
    Modules: row.modules.join(', '),
    Projects: row.projectNames.join(', ') || 'All',
  }));

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <ExportButton title="User access report" rows={exportRows} filename="user-access-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[26rem]">
        <HrDataList rows={rows} columns={columns} empty={<HrEmptyState title="No users" />} />
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 2. Role usage
 * ---------------------------------------------------------------------------------------------- */

function RoleUsageReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser, roleUsage } = state;

  const rows = useMemo(
    () =>
      directory.roles
        .map((role) => {
          const holders = directory.users.filter((user) =>
            (accessByUser[user.id]?.effectiveRoleNames ?? []).includes(role.name),
          );
          return {
            id: role.id,
            role,
            usage: roleUsage[role.name] ?? { base: 0, additional: 0, total: 0 },
            holders,
          };
        })
        .sort((a, b) => b.usage.total - a.usage.total),
    [directory.roles, directory.users, accessByUser, roleUsage],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'Role', mobile: 'title', cell: (row) => row.role.name },
    { header: 'Type', mobile: 'detail', cell: (row) => row.role.type ?? 'System' },
    { header: 'Permissions', align: 'right', mobile: 'detail', cell: (row) => countPermissions(row.role.permissions) },
    { header: 'As base role', align: 'right', mobile: 'detail', cell: (row) => row.usage.base },
    { header: 'As additional', align: 'right', mobile: 'detail', cell: (row) => row.usage.additional },
    { header: 'Total holders', align: 'right', mobile: 'aside', cell: (row) => row.usage.total },
    {
      header: 'Holders',
      className: 'hidden xl:table-cell',
      cell: (row) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {row.holders.slice(0, 8).map((user) => user.name || user.email).join(', ')}
          {row.holders.length > 8 ? ` +${row.holders.length - 8}` : ''}
        </span>
      ),
    },
  ];

  const exportRows = rows.flatMap((row) =>
    row.holders.length
      ? row.holders.map((user) => ({
          Role: row.role.name,
          'Role type': row.role.type ?? 'System',
          User: user.name || user.email,
          Email: user.email,
          'Held as': user.role === row.role.name ? 'Base role' : 'Additional role',
          'User status': user.status ?? 'Active',
        }))
      : [{ Role: row.role.name, 'Role type': row.role.type ?? 'System', User: '(nobody)', Email: '', 'Held as': '', 'User status': '' }],
  );

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <ExportButton title="Role usage report" rows={exportRows} filename="role-usage-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[26rem]">
        <HrDataList rows={rows} columns={columns} empty={<HrEmptyState title="No roles" />} />
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 3. Permission usage
 * ---------------------------------------------------------------------------------------------- */

function PermissionUsageReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser, registry } = state;
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('');

  const node: RegistryNode | undefined = registry.find((entry) => entry.resource === resource);

  const holders = useMemo(() => {
    if (!resource || !action) return [];
    return directory.users
      .filter((user) => (accessByUser[user.id]?.permissions[resource] ?? []).includes(action))
      .map((user) => ({
        id: user.id,
        user,
        sources: accessByUser[user.id]?.sources[`${resource}::${action}`] ?? [],
      }));
  }, [resource, action, directory.users, accessByUser]);

  const columns: Array<HrListColumn<(typeof holders)[number]>> = [
    { header: 'User', mobile: 'title', cell: (row) => row.user.name || row.user.email },
    { header: 'Status', mobile: 'aside', cell: (row) => row.user.status ?? 'Active' },
    { header: 'Base role', mobile: 'detail', cell: (row) => row.user.role || '—' },
    {
      header: 'Granted through',
      mobile: 'detail',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.sources.map((source) => `${source.label} (${source.kind})`).join(', ') || '—'}
        </span>
      ),
    },
  ];

  const exportRows = holders.map((row) => ({
    Permission: `${resource} · ${action}`,
    User: row.user.name || row.user.email,
    Email: row.user.email,
    Status: row.user.status ?? 'Active',
    'Base role': row.user.role || '',
    'Granted through': row.sources.map((source) => `${source.label} (${source.kind})`).join('; '),
  }));

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Permission</Label>
          <Select
            value={resource}
            onValueChange={(value) => {
              setResource(value);
              setAction('');
            }}
          >
            <SelectTrigger><SelectValue placeholder="Module › page" /></SelectTrigger>
            <SelectContent className="max-h-72 max-w-[calc(100vw-2rem)]">
              {registry.map((entry) => (
                <SelectItem key={entry.resource} value={entry.resource}>
                  <span className="block truncate">{entry.resource.split('.').join(' › ')}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Action</Label>
          <Select value={action} onValueChange={setAction} disabled={!node}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              {(node?.actions ?? []).map((entry) => (
                <SelectItem key={entry} value={entry}>{entry}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!resource || !action ? (
        <HrEmptyState icon={KeyRound} title="Pick a permission" description="You'll see everybody who holds it and which grant gives it to them." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline" className="whitespace-normal border-indigo-200 bg-indigo-50 text-indigo-700">
              {holders.length} user(s) hold {resource} · {action}
            </Badge>
            <ExportButton title="Permission usage report" rows={exportRows} filename="permission-usage-report.xlsx" />
          </div>
          <ScrollArea className="h-auto sm:h-[22rem]">
            <HrDataList
              rows={holders}
              columns={columns}
              empty={<HrEmptyState title="Nobody holds this permission" />}
            />
          </ScrollArea>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 4. Privileged users
 * ---------------------------------------------------------------------------------------------- */

function PrivilegedUsersReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser } = state;

  const rows = useMemo(
    () =>
      directory.users
        .map((user) => {
          const access = accessByUser[user.id];
          return {
            id: user.id,
            user,
            privileges: access ? detectPrivilegedAccess(access) : [],
            conflicts: access ? detectSodConflicts(access) : [],
            permissionCount: access?.permissionCount ?? 0,
          };
        })
        .filter((row) => row.privileges.length > 0 || row.conflicts.length > 0)
        .sort((a, b) => b.privileges.length + b.conflicts.length - (a.privileges.length + a.conflicts.length)),
    [directory.users, accessByUser],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'User', mobile: 'title', cell: (row) => row.user.name || row.user.email },
    { header: 'Status', mobile: 'aside', cell: (row) => row.user.status ?? 'Active' },
    { header: 'Base role', mobile: 'detail', cell: (row) => row.user.role || '—' },
    {
      header: 'Risk',
      mobile: 'detail',
      cell: (row) => <RiskBadges privileges={row.privileges} conflicts={row.conflicts} />,
    },
    {
      header: 'High privilege',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.privileges.map((finding) => finding.label).join('; ') || '—'}
        </span>
      ),
    },
    { header: 'Permissions', align: 'right', mobile: 'detail', cell: (row) => row.permissionCount },
  ];

  const exportRows = rows.map((row) => ({
    User: row.user.name || row.user.email,
    Email: row.user.email,
    Status: row.user.status ?? 'Active',
    'Base role': row.user.role || '',
    'High-privilege capabilities': row.privileges.map((finding) => finding.label).join('; '),
    'SoD conflicts': row.conflicts.map((conflict) => conflict.label).join('; '),
    'Effective permissions': row.permissionCount,
  }));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Detected from what these users can actually do, not from role names — a custom role that
          happens to grant user management shows up here.
        </p>
        <ExportButton title="Privileged user report" rows={exportRows} filename="privileged-user-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[24rem]">
        <HrDataList
          rows={rows}
          columns={columns}
          empty={<HrEmptyState title="No privileged users detected" description="Nobody currently holds a high-risk capability or a segregation-of-duties conflict." />}
        />
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 5. Project access
 * ---------------------------------------------------------------------------------------------- */

function ProjectAccessReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser, projects } = state;

  const rows = useMemo(
    () =>
      projects
        .map((project) => {
          const assigned = directory.users.filter((user) =>
            (accessByUser[user.id]?.projectIds ?? []).includes(project.id),
          );
          return { id: project.id, project, assigned };
        })
        .sort((a, b) => b.assigned.length - a.assigned.length),
    [projects, directory.users, accessByUser],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'Project', mobile: 'title', cell: (row) => row.project.projectName || row.project.siteCode || row.id },
    { header: 'Site code', mobile: 'detail', cell: (row) => row.project.siteCode || '—' },
    { header: 'Location', mobile: 'detail', cell: (row) => row.project.location || '—' },
    { header: 'Users assigned', align: 'right', mobile: 'aside', cell: (row) => row.assigned.length },
    {
      header: 'Users',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {row.assigned.slice(0, 8).map((user) => user.name || user.email).join(', ')}
          {row.assigned.length > 8 ? ` +${row.assigned.length - 8}` : ''}
        </span>
      ),
    },
  ];

  const exportRows = rows.flatMap((row) =>
    row.assigned.length
      ? row.assigned.map((user) => ({
          Project: row.project.projectName || row.id,
          'Site code': row.project.siteCode ?? '',
          User: user.name || user.email,
          Email: user.email,
          'Base role': user.role || '',
          Status: user.status ?? 'Active',
        }))
      : [{ Project: row.project.projectName || row.id, 'Site code': row.project.siteCode ?? '', User: '(nobody assigned)', Email: '', 'Base role': '', Status: '' }],
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Users with an explicit project grant. A user with no project restriction can reach every
          project and is not listed here.
        </p>
        <ExportButton title="Project access report" rows={exportRows} filename="project-access-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[24rem]">
        <HrDataList rows={rows} columns={columns} empty={<HrEmptyState title="No projects" />} />
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 6. Temporary access
 * ---------------------------------------------------------------------------------------------- */

function TemporaryAccessReport({ state }: { state: AccessDirectoryState }) {
  const { directory } = state;

  const rows = useMemo(() => {
    const out: Array<{
      id: string;
      userName: string;
      userEmail: string;
      roleName: string;
      startAt: string;
      expiresAt: string;
      grantState: string;
      reason: string;
      approvedByName: string;
      daysLeft: number | null;
    }> = [];

    for (const user of directory.users) {
      const grant = directory.grants[user.id];
      for (const temporary of grant?.temporaryAccess ?? []) {
        const grantState = temporaryGrantState(temporary);
        const expiry = Date.parse(temporary.expiresAt);
        out.push({
          id: `${user.id}-${temporary.id}`,
          userName: user.name || user.email || user.id,
          userEmail: user.email ?? '',
          roleName: temporary.roleName || 'Direct permissions',
          startAt: temporary.startAt,
          expiresAt: temporary.expiresAt,
          grantState,
          reason: temporary.reason ?? '',
          approvedByName: temporary.approvedByName ?? temporary.assignedByName ?? '',
          daysLeft: Number.isNaN(expiry) ? null : Math.ceil((expiry - Date.now()) / 86_400_000),
        });
      }
    }

    const order: Record<string, number> = { Active: 0, Upcoming: 1, Expired: 2, Revoked: 3 };
    return out.sort(
      (a, b) => (order[a.grantState] ?? 9) - (order[b.grantState] ?? 9) || a.expiresAt.localeCompare(b.expiresAt),
    );
  }, [directory]);

  const expiringSoon = useMemo(() => {
    const grants = directory.users.flatMap((user) => directory.grants[user.id]?.temporaryAccess ?? []);
    return expiringTemporaryGrants(grants, 7).length;
  }, [directory]);

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'User', mobile: 'title', cell: (row) => row.userName },
    { header: 'Grant', mobile: 'title', cell: (row) => row.roleName },
    {
      header: 'State',
      mobile: 'aside',
      cell: (row) => (
        <Badge
          variant="outline"
          className={
            row.grantState === 'Active'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : row.grantState === 'Upcoming'
                ? 'border-sky-200 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-500'
          }
        >
          {row.grantState}
        </Badge>
      ),
    },
    { header: 'From', mobile: 'detail', cell: (row) => formatGrantDate(row.startAt) },
    { header: 'Until', mobile: 'detail', cell: (row) => formatGrantDate(row.expiresAt) },
    {
      header: 'Days left',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (row.grantState === 'Active' && row.daysLeft !== null ? row.daysLeft : '—'),
    },
    // A free-text reason in a phone card's two-column detail grid truncates to four words, so it
    // gets the card's full-width footer row instead; "approved by" is not worth a phone's space.
    {
      header: 'Reason',
      className: 'hidden lg:table-cell',
      mobile: 'footer',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.reason || '—'}</span>,
    },
    { header: 'Approved by', className: 'hidden xl:table-cell', mobile: 'omit', cell: (row) => row.approvedByName || '—' },
  ];

  const exportRows = rows.map((row) => ({
    User: row.userName,
    Email: row.userEmail,
    Grant: row.roleName,
    State: row.grantState,
    From: row.startAt,
    Until: row.expiresAt,
    'Days left': row.grantState === 'Active' ? row.daysLeft : '',
    Reason: row.reason,
    'Approved by': row.approvedByName,
  }));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            {rows.filter((row) => row.grantState === 'Active').length} active
          </Badge>
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
            {expiringSoon} expiring within 7 days
          </Badge>
          <Badge variant="outline" className="text-slate-500">
            {rows.filter((row) => row.grantState === 'Expired').length} expired (kept for audit)
          </Badge>
        </div>
        <ExportButton title="Temporary access report" rows={exportRows} filename="temporary-access-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[24rem]">
        <HrDataList
          rows={rows}
          columns={columns}
          empty={<HrEmptyState title="No temporary access granted" description="Temporary grants lapse on their own and stay listed here afterwards for the audit trail." />}
        />
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 7. Access changes
 * ---------------------------------------------------------------------------------------------- */

function AccessChangeReport({ state }: { state: AccessDirectoryState }) {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const entries = await listAccessAuditEntries({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        limit: 1000,
      });
      setRows(
        entries.map((entry) => ({
          When: entry.changedAt,
          'Affected user': entry.targetUserName,
          Action: entry.action,
          Roles: entry.roleNames.join(', '),
          'Permissions added': entry.permissionsAdded.length,
          'Permissions removed': entry.permissionsRemoved.length,
          Source: entry.sourceKind,
          'Changed by': entry.changedByName,
          Reason: entry.reason ?? '',
          Batch: entry.batchId ?? '',
        })),
      );
    } catch (error) {
      toast({
        title: 'Could not build the report',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="flex items-end [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button size="sm" onClick={() => void run()} disabled={loading}>
            {loading ? 'Building…' : 'Build report'}
          </Button>
        </div>
        <div className="flex items-end justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
          <ExportButton title="Access change report" rows={rows} filename="access-change-report.xlsx" />
        </div>
      </div>

      {rows.length === 0 ? (
        <HrEmptyState
          icon={FileSpreadsheet}
          title="No changes in this range"
          description="Pick a date range and build the report. Every grant and removal is included."
        />
      ) : (
        <ScrollArea className="h-auto sm:h-[22rem] rounded-xl border border-white/70 bg-white/60">
          <div className="divide-y divide-slate-100 text-xs">
            {rows.map((row, index) => (
              <div key={index} className="px-3 py-2">
                <p className="font-medium text-slate-800">
                  {String(row['Affected user'])} — {String(row.Action)}
                  {row.Roles ? `: ${String(row.Roles)}` : ''}
                </p>
                <p className="text-muted-foreground">
                  {formatGrantDate(String(row.When))} · by {String(row['Changed by'])} · +
                  {String(row['Permissions added'])} / −{String(row['Permissions removed'])}
                  {row.Batch ? ` · ${String(row.Batch)}` : ''}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 8. Inactive users still holding access
 * ---------------------------------------------------------------------------------------------- */

function InactiveUsersReport({ state }: { state: AccessDirectoryState }) {
  const { directory, accessByUser } = state;

  const rows = useMemo(
    () =>
      directory.users
        .filter((user) => user.status === 'Inactive')
        .map((user) => {
          const access = accessByUser[user.id];
          const grant = directory.grants[user.id];
          return {
            id: user.id,
            user,
            permissionCount: access?.permissionCount ?? 0,
            additionalRoles: grant?.additionalRoles.map((entry) => entry.roleName) ?? [],
            privileges: access ? detectPrivilegedAccess(access) : [],
          };
        })
        .filter((row) => row.permissionCount > 0)
        .sort((a, b) => b.permissionCount - a.permissionCount),
    [directory, accessByUser],
  );

  const columns: Array<HrListColumn<(typeof rows)[number]>> = [
    { header: 'User', mobile: 'title', cell: (row) => row.user.name || row.user.email },
    { header: 'Email', mobile: 'detail', cell: (row) => row.user.email },
    { header: 'Base role', mobile: 'detail', cell: (row) => row.user.role || '—' },
    {
      header: 'Additional roles',
      mobile: 'detail',
      cell: (row) => row.additionalRoles.join(', ') || '—',
    },
    { header: 'Permissions still held', align: 'right', mobile: 'aside', cell: (row) => row.permissionCount },
    {
      header: 'Risk',
      mobile: 'detail',
      cell: (row) => <RiskBadges privileges={row.privileges} conflicts={[]} />,
    },
  ];

  const exportRows = rows.map((row) => ({
    User: row.user.name || row.user.email,
    Email: row.user.email,
    'Base role': row.user.role || '',
    'Additional roles': row.additionalRoles.join(', '),
    'Permissions still held': row.permissionCount,
    'High privilege': row.privileges.map((finding) => finding.label).join('; '),
  }));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          These accounts are deactivated, so they cannot sign in — but the permission grants are still
          attached to them, and reactivating the account restores everything. Worth reviewing when
          somebody has left for good.
        </p>
        <ExportButton title="Inactive user access report" rows={exportRows} filename="inactive-user-access-report.xlsx" />
      </div>
      <ScrollArea className="h-auto sm:h-[24rem]">
        <HrDataList
          rows={rows}
          columns={columns}
          empty={<HrEmptyState title="No inactive users hold access" description="Every deactivated account has no permissions attached." />}
        />
      </ScrollArea>
    </div>
  );
}
