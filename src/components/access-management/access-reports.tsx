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
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { HrDataList, HrEmptyState, type HrListColumn } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
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
import { RiskBadges, RoleBadge } from './access-ui';

export type ReportId =
  | 'user-access'
  | 'role-usage'
  | 'permission-usage'
  | 'privileged'
  | 'project-access'
  | 'temporary'
  | 'changes'
  | 'inactive';

const REPORTS: Array<{ id: ReportId; label: string; description: string; icon: LucideIcon }> = [
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

      {/* Compact chips on one row (wrapping only where a window cannot fit eight). The description
          each tile used to carry is repeated in the card header below, so a chip needs only its
          icon and name — it stays in the tooltip for a hover. */}
      <div className="hidden flex-wrap gap-2 sm:flex">
        {REPORTS.map((entry) => {
          const Icon = entry.icon;
          const active = entry.id === selected;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry.id)}
              aria-pressed={active}
              title={entry.description}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                  : 'border-white/70 bg-white/80 text-slate-700 hover:bg-slate-50',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-600' : 'text-slate-400')} />
              {entry.label}
            </button>
          );
        })}
      </div>

      {/* Each report is its own register frame (`TableCard`): the report's name and description as
          the title, its Export among the actions, its parameters in the toolbar, and the rows
          scrolling inside the card under a pinned header. */}
      {selected === 'user-access' && <UserAccessReport state={state} meta={report} />}
      {selected === 'role-usage' && <RoleUsageReport state={state} meta={report} />}
      {selected === 'permission-usage' && <PermissionUsageReport state={state} meta={report} />}
      {selected === 'privileged' && <PrivilegedUsersReport state={state} meta={report} />}
      {selected === 'project-access' && <ProjectAccessReport state={state} meta={report} />}
      {selected === 'temporary' && <TemporaryAccessReport state={state} meta={report} />}
      {selected === 'changes' && <AccessChangeReport state={state} meta={report} />}
      {selected === 'inactive' && <InactiveUsersReport state={state} meta={report} />}
    </div>
  );
}

type ReportMeta = (typeof REPORTS)[number];

/**
 * A report's rows inside its frame: the phone cards inset from the card's edge, the desktop table
 * flush with it, and the empty state inset like the cards.
 */
function ReportList<T extends { id: string }>({
  rows,
  columns,
  empty,
}: {
  rows: T[];
  columns: Array<HrListColumn<T>>;
  empty: React.ReactNode;
}) {
  if (!rows.length) return <div className="p-3">{empty}</div>;
  return (
    <div className="p-3 sm:p-0">
      <HrDataList rows={rows} columns={columns} frameless />
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

function UserAccessReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      count={rows.length}
      noun="user"
      actions={<ExportButton title="User access report" rows={exportRows} filename="user-access-report.xlsx" />}
    >
      <ReportList rows={rows} columns={columns} empty={<HrEmptyState title="No users" />} />
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 2. Role usage
 * ---------------------------------------------------------------------------------------------- */

function RoleUsageReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      count={rows.length}
      noun="role"
      actions={<ExportButton title="Role usage report" rows={exportRows} filename="role-usage-report.xlsx" />}
    >
      <ReportList rows={rows} columns={columns} empty={<HrEmptyState title="No roles" />} />
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 3. Permission usage
 * ---------------------------------------------------------------------------------------------- */

function PermissionUsageReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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

  const picked = Boolean(resource && action);

  return (
    <TableCard
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      actions={
        picked ? (
          <>
            <Badge variant="neutral" className="whitespace-normal">
              {holders.length} user(s) hold {resource} · {action}
            </Badge>
            <ExportButton title="Permission usage report" rows={exportRows} filename="permission-usage-report.xlsx" />
          </>
        ) : undefined
      }
      // The report's parameters — a labelled form that drives the report, not a list filter.
      toolbar={
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      }
    >
      {!picked ? (
        <div className="p-3">
          <HrEmptyState icon={KeyRound} title="Pick a permission" description="You'll see everybody who holds it and which grant gives it to them." />
        </div>
      ) : (
        <ReportList rows={holders} columns={columns} empty={<HrEmptyState title="Nobody holds this permission" />} />
      )}
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 4. Privileged users
 * ---------------------------------------------------------------------------------------------- */

function PrivilegedUsersReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={
        <>
          {meta.description} Detected from what these users can actually do, not from role names — a
          custom role that happens to grant user management shows up here.
        </>
      }
      icon={meta.icon}
      count={rows.length}
      noun="user"
      actions={<ExportButton title="Privileged user report" rows={exportRows} filename="privileged-user-report.xlsx" />}
    >
      <ReportList
        rows={rows}
        columns={columns}
        empty={<HrEmptyState title="No privileged users detected" description="Nobody currently holds a high-risk capability or a segregation-of-duties conflict." />}
      />
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 5. Project access
 * ---------------------------------------------------------------------------------------------- */

function ProjectAccessReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={
        <>
          {meta.description} Users with an explicit project grant. A user with no project restriction
          can reach every project and is not listed here.
        </>
      }
      icon={meta.icon}
      count={rows.length}
      noun="project"
      actions={<ExportButton title="Project access report" rows={exportRows} filename="project-access-report.xlsx" />}
    >
      <ReportList rows={rows} columns={columns} empty={<HrEmptyState title="No projects" />} />
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 6. Temporary access
 * ---------------------------------------------------------------------------------------------- */

/**
 * A temporary grant's state in this module's terms. "Active" means a lapsing grant is in force,
 * which the module flags as a caution (warning), not a success; "Expired" is kept for the audit
 * trail, not an alarm (neutral) — so neither is left to the shared vocabulary.
 */
const TEMPORARY_STATE_TONE: Record<string, StatusTone> = {
  Active: 'warning',
  Upcoming: 'info',
};

function TemporaryAccessReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
        <StatusBadge status={row.grantState} tone={TEMPORARY_STATE_TONE[row.grantState] ?? 'neutral'}>
          {row.grantState}
        </StatusBadge>
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
    <TableCard
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      count={rows.length}
      noun="grant"
      actions={
        <>
          {/* Summary counts, toned like the State column they total. */}
          <Badge variant="warning">{rows.filter((row) => row.grantState === 'Active').length} active</Badge>
          <Badge variant="danger">{expiringSoon} expiring within 7 days</Badge>
          <Badge variant="outline">
            {rows.filter((row) => row.grantState === 'Expired').length} expired (kept for audit)
          </Badge>
          <ExportButton title="Temporary access report" rows={exportRows} filename="temporary-access-report.xlsx" />
        </>
      }
    >
      <ReportList
        rows={rows}
        columns={columns}
        empty={<HrEmptyState title="No temporary access granted" description="Temporary grants lapse on their own and stay listed here afterwards for the audit trail." />}
      />
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 7. Access changes
 * ---------------------------------------------------------------------------------------------- */

function AccessChangeReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={meta.description}
      icon={meta.icon}
      count={rows.length}
      noun="change"
      actions={<ExportButton title="Access change report" rows={rows} filename="access-change-report.xlsx" />}
      // The report's parameters — a date range and the button that builds it, not a list filter.
      toolbar={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="col-span-2 flex items-end sm:col-span-1 [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button size="sm" onClick={() => void run()} disabled={loading}>
              {loading ? 'Building…' : 'Build report'}
            </Button>
          </div>
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className="p-3">
          <HrEmptyState
            icon={FileSpreadsheet}
            title="No changes in this range"
            description="Pick a date range and build the report. Every grant and removal is included."
          />
        </div>
      ) : (
        // A plain list, not a ScrollArea: the card scrolls it.
        <div className="divide-y divide-slate-100 text-xs">
          {rows.map((row, index) => (
            <div key={index} className="px-4 py-2 sm:px-5">
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
      )}
    </TableCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * 8. Inactive users still holding access
 * ---------------------------------------------------------------------------------------------- */

function InactiveUsersReport({ state, meta }: { state: AccessDirectoryState; meta: ReportMeta }) {
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
    <TableCard
      title={meta.label}
      description={
        <>
          {meta.description} These accounts are deactivated, so they cannot sign in — but the permission
          grants are still attached to them, and reactivating the account restores everything. Worth
          reviewing when somebody has left for good.
        </>
      }
      icon={meta.icon}
      count={rows.length}
      noun="user"
      actions={<ExportButton title="Inactive user access report" rows={exportRows} filename="inactive-user-access-report.xlsx" />}
    >
      <ReportList
        rows={rows}
        columns={columns}
        empty={<HrEmptyState title="No inactive users hold access" description="Every deactivated account has no permissions attached." />}
      />
    </TableCard>
  );
}
