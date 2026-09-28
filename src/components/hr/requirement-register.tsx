'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Download, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HR_COLLECTIONS,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  dayDifference,
  evaluateRequirementSla,
  hrStatusLabel,
  isOpenRequirementStatus,
  summarizeRequirementFill,
  type HrRequirement,
  type RequirementStatus,
} from '@/lib/hr-requirement';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  HrDataList,
  HrEmptyState,
  HrFillBar,
  HrLoader,
  hrBadgeTone,
  hrPriorityBadgeTone,
  hrSlaLabel,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';

/**
 * The requirement register of spec section 54 — every requisition, with the columns the spec lists
 * and a row that opens the Requirement Workspace.
 *
 * Filtering happens in memory over the organisation's requirements rather than through Firestore
 * queries. Eleven independent filters (section 3) would need a composite index per combination, and
 * a requisition register is measured in hundreds of rows a year, not millions.
 */

export type RegisterScope = 'all' | 'open' | 'mine' | 'overdue' | 'unassigned';

const STATUS_GROUPS: Record<string, RequirementStatus[]> = {
  'Pending approval': ['SUBMITTED', 'PENDING_HOD_APPROVAL', 'PENDING_HR_APPROVAL', 'PENDING_BUDGET_APPROVAL', 'PENDING_MANAGEMENT_APPROVAL'],
  Recruiting: ['OPEN', 'SOURCING', 'SCREENING', 'INTERVIEWING', 'SELECTION_IN_PROGRESS', 'OFFER_IN_PROGRESS', 'PARTIALLY_FILLED', 'REOPENED'],
  Closed: ['FILLED', 'CLOSED', 'CANCELLED', 'REJECTED', 'EXPIRED'],
};

export default function RequirementRegister({
  scope = 'all',
  title,
  description,
}: {
  scope?: RegisterScope;
  title?: string;
  description?: string;
}) {
  const { settings, departments, projects, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priority, setPriority] = useState('all');
  const [requirementType, setRequirementType] = useState('all');
  const [recruiterId, setRecruiterId] = useState('all');

  /** Derived once per requirement, so fill, age and SLA are computed in a single pass. */
  const decorated = useMemo(
    () =>
      requirements.map(requirement => {
        const fill = summarizeRequirementFill({
          requestedQuantity: requirement.requestedQuantity,
          joinedCount: requirement.joinedCount,
          offerAcceptedCount: requirement.offerAcceptedCount,
          offeredCount: requirement.offeredCount,
          inPipelineCount: requirement.applicationCount,
          cancelledPositions: requirement.cancelledPositions,
        });
        const slaStart = requirement.slaStartedAt?.toDate?.() || null;
        const sla = evaluateRequirementSla({
          startedAt: slaStart,
          targetDays: requirement.slaTargetDays || settings.sla.targets[requirement.priority] || settings.sla.targets.Normal,
          heldDays: requirement.slaHeldDays,
          pauseOnHold: settings.sla.pauseOnHold,
        });
        const created = requirement.createdAt?.toDate?.() || null;
        return {
          ...requirement,
          fill,
          sla,
          ageDays: created ? Math.max(0, dayDifference(created, new Date())) : 0,
        };
      }),
    [requirements, settings],
  );

  const recruiters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const requirement of requirements) {
      if (requirement.primaryRecruiterId) {
        seen.set(requirement.primaryRecruiterId, requirement.primaryRecruiterName || 'Recruiter');
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [requirements]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return decorated
      .filter(requirement => {
        switch (scope) {
          case 'open':
            return isOpenRequirementStatus(requirement.status);
          case 'mine':
            return (
              requirement.primaryRecruiterId === actor?.userId ||
              requirement.secondaryRecruiterId === actor?.userId ||
              requirement.requestingManagerId === actor?.userId
            );
          case 'overdue':
            return requirement.sla.state === 'Overdue';
          case 'unassigned':
            return isOpenRequirementStatus(requirement.status) && !requirement.primaryRecruiterId;
          default:
            return true;
        }
      })
      .filter(requirement => {
        if (departmentId !== 'all' && requirement.departmentId !== departmentId) return false;
        if (projectId !== 'all' && requirement.projectId !== projectId) return false;
        if (priority !== 'all' && requirement.priority !== priority) return false;
        if (requirementType !== 'all' && requirement.requirementType !== requirementType) return false;
        if (recruiterId !== 'all' && requirement.primaryRecruiterId !== recruiterId) return false;

        if (statusFilter !== 'all') {
          const group = STATUS_GROUPS[statusFilter];
          if (group) {
            if (!group.includes(requirement.status)) return false;
          } else if (requirement.status !== statusFilter) {
            return false;
          }
        }

        if (term) {
          const haystack = [
            requirement.requirementNumber,
            requirement.designation,
            requirement.jobTitle,
            requirement.departmentName,
            requirement.projectName,
            requirement.location,
            requirement.requestingManagerName,
            requirement.primaryRecruiterName,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      // Newest first, but anything overdue floats up — an ageing requisition is the thing a
      // recruiter opening this screen needs to see, not the one raised this morning.
      .sort((a, b) => {
        if (a.sla.state === 'Overdue' && b.sla.state !== 'Overdue') return -1;
        if (b.sla.state === 'Overdue' && a.sla.state !== 'Overdue') return 1;
        return (b.requirementDate || '').localeCompare(a.requirementDate || '');
      });
  }, [decorated, scope, actor, departmentId, projectId, priority, requirementType, recruiterId, statusFilter, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (accumulator, row) => ({
          requested: accumulator.requested + row.fill.effectiveRequired,
          joined: accumulator.joined + row.fill.joined,
          balance: accumulator.balance + row.fill.balance,
        }),
        { requested: 0, joined: 0, balance: 0 },
      ),
    [filtered],
  );

  const columns: Array<HrListColumn<(typeof filtered)[number]>> = [
    {
      header: 'Requirement',
      mobile: 'title',
      cell: row => (
        <Link href={`/hr/requirements/${row.id}`} className="font-medium text-indigo-700 hover:underline">
          {row.requirementNumber}
        </Link>
      ),
    },
    {
      header: 'Designation',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.designation}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.departmentName}
            {row.projectName ? ` · ${row.projectName}` : ''}
          </p>
        </div>
      ),
    },
    { header: 'Date', className: 'hidden xl:table-cell', cell: row => row.requirementDate || '—' },
    { header: 'Location', className: 'hidden xl:table-cell', cell: row => row.location || row.siteName || '—' },
    { header: 'Type', className: 'hidden lg:table-cell', cell: row => row.requirementType },
    {
      header: 'Required',
      align: 'right',
      cell: row => <span className="tabular-nums font-medium">{row.fill.effectiveRequired}</span>,
    },
    { header: 'Joined', align: 'right', cell: row => <span className="tabular-nums">{row.fill.joined}</span> },
    {
      header: 'Balance',
      align: 'right',
      cell: row => (
        <span className={row.fill.balance > 0 ? 'font-medium tabular-nums text-rose-700' : 'tabular-nums text-muted-foreground'}>
          {row.fill.balance}
        </span>
      ),
    },
    {
      header: 'Fill',
      className: 'hidden lg:table-cell',
      mobile: 'omit',
      cell: row => (
        <HrFillBar required={row.fill.effectiveRequired} joined={row.fill.joined} accepted={row.fill.offerAccepted} compact />
      ),
    },
    {
      header: 'Priority',
      mobile: 'aside',
      cell: row => (
        <StatusBadge status={row.priority} tone={hrPriorityBadgeTone(row.priority)}>
          {row.priority}
        </StatusBadge>
      ),
    },
    {
      header: 'Recruiter',
      className: 'hidden lg:table-cell',
      cell: row => row.primaryRecruiterName || <span className="text-muted-foreground">Unassigned</span>,
    },
    { header: 'Target', className: 'hidden xl:table-cell', cell: row => row.targetClosureDate || '—' },
    { header: 'Age', align: 'right', className: 'hidden md:table-cell', cell: row => `${row.ageDays}d` },
    {
      header: 'SLA',
      cell: row => (
        <StatusBadge status={row.sla.state}>
          {hrSlaLabel(row.sla.state, row.sla.consumedPercent, row.sla.overdueDays)}
        </StatusBadge>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: row => (
        <StatusBadge status={row.status} tone={hrBadgeTone(row.status)}>
          {hrStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
  ];

  const activeFilterCount = [departmentId, projectId, statusFilter, priority, requirementType, recruiterId].filter(
    value => value !== 'all',
  ).length;

  const handleExport = () => {
    exportRowsToExcel(
      'HR Requirement Register',
      filtered.map(row => ({
        'Requirement ID': row.requirementNumber,
        Date: row.requirementDate,
        Department: row.departmentName,
        Project: row.projectName || '',
        Location: row.location || '',
        Designation: row.designation,
        Grade: row.grade,
        'Requested Qty': row.fill.effectiveRequired,
        'Joined Qty': row.fill.joined,
        'Balance Qty': row.fill.balance,
        Type: row.requirementType,
        Priority: row.priority,
        'Requested By': row.requestingManagerName,
        Recruiter: row.primaryRecruiterName || '',
        'Target Date': row.targetClosureDate || '',
        'Age (days)': row.ageDays,
        SLA: row.sla.state,
        Status: row.status,
      })),
    );
  };

  if (loading || configLoading) return <HrLoader label="Loading requirements…" />;

  return (
    <div>
      <PageHeader
        title={title || 'Requirement Register'}
        description={
          description ||
          `${filtered.length} ${filtered.length === 1 ? 'requirement' : 'requirements'} · ${totals.requested} positions · ${totals.joined} joined · ${totals.balance} balance`
        }
        actions={
          <>
            {permissions.can('Export', 'Requirements') && (
              <Button variant="outline" onClick={handleExport} className="gap-2">
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            {permissions.can('Add', 'Requirements') && (
              <Button asChild className="gap-2">
                <Link href="/hr/requirements/new">
                  <Plus className="h-4 w-4" /> New Requirement
                </Link>
              </Button>
            )}
          </>
        }
      />

      <TableCard
        title="Requirements"
        count={filtered.length}
        total={decorated.length}
        noun="requirement"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Requirement ID, designation, project, recruiter…' }}
            activeCount={activeFilterCount}
            onClear={() => {
              setSearch('');
              setDepartmentId('all');
              setProjectId('all');
              setStatusFilter('all');
              setPriority('all');
              setRequirementType('all');
              setRecruiterId('all');
            }}
          >
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map(department => (
                  <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Project"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.keys(STATUS_GROUPS).map(group => (
                  <SelectItem key={group} value={group}>{group}</SelectItem>
                ))}
                {REQUIREMENT_STATUSES.map(status => (
                  <SelectItem key={status} value={status}>{status.replace(/_/g, ' ').toLowerCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {REQUIREMENT_PRIORITIES.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={requirementType} onValueChange={setRequirementType}>
              <SelectTrigger aria-label="Requirement type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {REQUIREMENT_TYPES.map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={recruiterId} onValueChange={setRecruiterId}>
              <SelectTrigger aria-label="Recruiter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All recruiters</SelectItem>
                {recruiters.map(recruiter => (
                  <SelectItem key={recruiter.id} value={recruiter.id}>{recruiter.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-0">
          <HrDataList
            frameless
            rows={filtered}
            columns={columns}
            cardHref={row => `/hr/requirements/${row.id}`}
            rowClassName={row => (row.sla.state === 'Overdue' ? 'bg-rose-50/40' : undefined)}
            empty={
              <HrEmptyState
                icon={ClipboardList}
                title="No requirements match these filters"
                description="Adjust the filters, or raise a new manpower requirement."
                action={
                  permissions.can('Add', 'Requirements') ? (
                    <Button asChild size="sm" className="gap-2">
                      <Link href="/hr/requirements/new">
                        <Plus className="h-4 w-4" /> New Requirement
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </div>
      </TableCard>
    </div>
  );
}
