'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, ChevronRight, Download, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  HR_COLLECTIONS,
  isOpenRequirementStatus,
  summarizeManpowerPosition,
  summarizeRequirementFill,
  type HrManpowerPlan,
  type HrOffer,
  type HrRequirement,
  type JoiningRecord,
} from '@/lib/hr-requirement';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrMeter,
  HrPageHeader,
  HrSection,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Project manpower control — spec section 61, the screen that turns this module into a manpower
 * control system rather than an applicant tracker.
 *
 * Management picks a project and sees the whole position at once: sanctioned against on-roll, what is
 * under recruitment, what is offered, who is awaiting joining, and — the figure that actually
 * prompts a decision — the shortage with no recruitment behind it. Then it drills down by
 * designation, exactly as the spec sketches.
 *
 * Everything is derived: nothing on this screen is entered anywhere. Sanctioned strength comes from
 * the manpower plan, recruitment from open requirements, offers from the offer collection, awaited
 * joinings from joining records.
 */

export default function ProjectManpower() {
  const { projects, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: plans, loading } = useHrCollection<HrManpowerPlan>(HR_COLLECTIONS.manpowerPlans);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);

  const [projectId, setProjectId] = useState('all');

  /** One row per (project × designation), assembled from the plan and the live pipeline. */
  const rows = useMemo(() => {
    type Row = {
      id: string;
      projectId: string;
      projectName: string;
      designation: string;
      approvedStrength: number;
      existing: number;
      underRecruitment: number;
      offered: number;
      joiningAwaited: number;
    };
    const map = new Map<string, Row>();

    const keyFor = (project: string, designation: string) => `${project}__${designation}`.toLowerCase();
    const ensure = (project: string, projectName: string, designation: string): Row => {
      const key = keyFor(project, designation);
      let row = map.get(key);
      if (!row) {
        row = {
          id: key,
          projectId: project,
          projectName,
          designation,
          approvedStrength: 0,
          existing: 0,
          underRecruitment: 0,
          offered: 0,
          joiningAwaited: 0,
        };
        map.set(key, row);
      }
      return row;
    };

    const projectName = (id: string) => projects.find(project => project.id === id)?.projectName || 'Unassigned';

    for (const plan of plans) {
      if (!plan.projectId) continue;
      if (plan.status === 'Closed') continue;
      const row = ensure(plan.projectId, plan.projectName || projectName(plan.projectId), plan.designation);
      row.approvedStrength += Number(plan.approvedStrength) || 0;
      row.existing += Number(plan.existingStrength) || 0;
    }

    for (const requirement of requirements) {
      if (!requirement.projectId) continue;
      if (!isOpenRequirementStatus(requirement.status)) continue;
      const fill = summarizeRequirementFill({
        requestedQuantity: requirement.requestedQuantity,
        joinedCount: requirement.joinedCount,
        cancelledPositions: requirement.cancelledPositions,
      });
      const row = ensure(
        requirement.projectId,
        requirement.projectName || projectName(requirement.projectId),
        requirement.designation,
      );
      row.underRecruitment += fill.balance;
      /*
       * A requirement raised against a designation with no plan line still has to appear here — a
       * project recruiting for a role nobody sanctioned is precisely what management needs to see,
       * and dropping it would make this screen agree with the plan while disagreeing with reality.
       */
      if (row.approvedStrength === 0) row.approvedStrength += fill.effectiveRequired;
    }

    for (const offer of offers) {
      if (!offer.projectId) continue;
      if (!['SENT', 'VIEWED'].includes(offer.status)) continue;
      const row = ensure(offer.projectId, offer.projectName || projectName(offer.projectId), offer.designation);
      row.offered += 1;
    }

    /*
     * Only joinings that have *not* happened yet are counted here. A candidate who has joined is on
     * roll, and on-roll strength comes from the plan's `existingStrength` — counting them again from
     * the joining records would double-count everyone hired since the plan was last refreshed.
     * Keeping the plan authoritative is also what makes the sanctioned-versus-actual comparison
     * meaningful; HR refreshes it, and this screen reports it.
     */
    for (const joining of joinings) {
      if (!joining.projectId) continue;
      if (!['CONFIRMED', 'CONFIRMATION_PENDING', 'DOCUMENTS_PENDING', 'POSTPONED'].includes(joining.status)) continue;
      const row = ensure(joining.projectId, joining.projectName || projectName(joining.projectId), joining.designation);
      row.joiningAwaited += 1;
    }

    return Array.from(map.values()).map(row => ({
      ...row,
      position: summarizeManpowerPosition({
        approvedStrength: row.approvedStrength,
        existing: row.existing,
        underRecruitment: row.underRecruitment,
        offered: row.offered,
        joiningAwaited: row.joiningAwaited,
      }),
    }));
  }, [plans, requirements, offers, joinings, projects]);

  /** Project-level rollup — the header block of the spec's sketch. */
  const byProject = useMemo(() => {
    const map = new Map<string, { projectId: string; projectName: string; rows: typeof rows }>();
    for (const row of rows) {
      const entry = map.get(row.projectId);
      if (entry) entry.rows.push(row);
      else map.set(row.projectId, { projectId: row.projectId, projectName: row.projectName, rows: [row] });
    }
    return Array.from(map.values())
      .map(entry => {
        const totals = entry.rows.reduce(
          (accumulator, row) => ({
            approvedStrength: accumulator.approvedStrength + row.position.approvedStrength,
            existing: accumulator.existing + row.position.existing,
            underRecruitment: accumulator.underRecruitment + row.position.underRecruitment,
            offered: accumulator.offered + row.position.offered,
            joiningAwaited: accumulator.joiningAwaited + row.position.joiningAwaited,
          }),
          { approvedStrength: 0, existing: 0, underRecruitment: 0, offered: 0, joiningAwaited: 0 },
        );
        return { ...entry, position: summarizeManpowerPosition(totals) };
      })
      .sort((a, b) => b.position.criticalShortage - a.position.criticalShortage || a.projectName.localeCompare(b.projectName));
  }, [rows]);

  const selected = projectId === 'all' ? null : byProject.find(entry => entry.projectId === projectId) || null;
  const detailRows = (selected ? selected.rows : rows).sort(
    (a, b) => b.position.criticalShortage - a.position.criticalShortage || a.designation.localeCompare(b.designation),
  );

  const columns: Array<HrListColumn<(typeof detailRows)[number]>> = [
    {
      header: 'Designation',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.designation}</p>
          {!selected && <p className="truncate text-xs text-muted-foreground">{row.projectName}</p>}
        </div>
      ),
    },
    {
      header: 'Position',
      mobile: 'title',
      cell: row => (
        <span className="tabular-nums text-sm font-medium">
          {row.position.existing} / {row.position.approvedStrength}
        </span>
      ),
    },
    { header: 'Under recruitment', align: 'right', cell: row => <span className="tabular-nums">{row.position.underRecruitment}</span> },
    { header: 'Offered', align: 'right', className: 'hidden lg:table-cell', cell: row => <span className="tabular-nums">{row.position.offered}</span> },
    { header: 'Joining awaited', align: 'right', className: 'hidden lg:table-cell', cell: row => <span className="tabular-nums">{row.position.joiningAwaited}</span> },
    {
      header: 'Shortage',
      align: 'right',
      cell: row => (
        <span className={row.position.shortage > 0 ? 'font-medium tabular-nums text-amber-700' : 'tabular-nums text-muted-foreground'}>
          {row.position.shortage}
        </span>
      ),
    },
    {
      header: 'Critical',
      align: 'right',
      mobile: 'aside',
      cell: row =>
        row.position.criticalShortage > 0 ? (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 tabular-nums text-rose-800">
            {row.position.criticalShortage}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Fulfilment',
      className: 'hidden xl:table-cell',
      mobile: 'omit',
      cell: row => (
        <div className="w-24">
          <HrMeter label="" percent={row.position.fulfilmentPercent} />
        </div>
      ),
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading project manpower…" />;

  const overall = summarizeManpowerPosition(
    detailRows.reduce(
      (accumulator, row) => ({
        approvedStrength: accumulator.approvedStrength + row.position.approvedStrength,
        existing: accumulator.existing + row.position.existing,
        underRecruitment: accumulator.underRecruitment + row.position.underRecruitment,
        offered: accumulator.offered + row.position.offered,
        joiningAwaited: accumulator.joiningAwaited + row.position.joiningAwaited,
      }),
      { approvedStrength: 0, existing: 0, underRecruitment: 0, offered: 0, joiningAwaited: 0 },
    ),
  );

  return (
    <div>
      <HrPageHeader
        title="Project Manpower"
        description={selected ? selected.projectName : `${byProject.length} ${byProject.length === 1 ? 'project' : 'projects'}`}
        actions={
          permissions.can('Export', 'Project Manpower') && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                exportRowsToExcel(
                  'Project Manpower',
                  detailRows.map(row => ({
                    Project: row.projectName,
                    Designation: row.designation,
                    'Approved Manpower': row.position.approvedStrength,
                    Existing: row.position.existing,
                    'Under Recruitment': row.position.underRecruitment,
                    Offered: row.position.offered,
                    'Joining Awaited': row.position.joiningAwaited,
                    Shortage: row.position.shortage,
                    'Critical Shortage': row.position.criticalShortage,
                    'Fulfilment %': row.position.fulfilmentPercent,
                    Position: row.position.status,
                  })),
                )
              }
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          )
        }
      />

      <div className="mb-3 sm:w-80">
        <Label className="text-xs">Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All projects</SelectItem>
            {byProject.map(entry => (
              <SelectItem key={entry.projectId} value={entry.projectId}>
                {entry.projectName}
                {entry.position.criticalShortage > 0 ? ` · ${entry.position.criticalShortage} critical` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* The header figures of the spec's sketch. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <HrKpiCard label="Approved manpower" value={overall.approvedStrength} icon={Building2} tone="blue" />
        <HrKpiCard label="Existing" value={overall.existing} icon={Users} tone="emerald" />
        <HrKpiCard label="Under recruitment" value={overall.underRecruitment} tone="indigo" />
        <HrKpiCard label="Offered" value={overall.offered} tone="violet" />
        <HrKpiCard label="Joining awaited" value={overall.joiningAwaited} tone="teal" />
        <HrKpiCard label="Shortage" value={overall.shortage} tone="amber" />
        <HrKpiCard
          label="Critical shortage"
          value={overall.criticalShortage}
          tone="rose"
          hint="No recruitment running"
        />
      </div>

      {/* Project rollup, worst first — a project list ordered alphabetically buries the problem. */}
      {projectId === 'all' && byProject.length > 0 && (
        <HrSection title="By project" description="Ordered by critical shortage, so the projects needing action come first." className="mb-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {byProject.map(entry => (
              <button
                key={entry.projectId}
                type="button"
                onClick={() => setProjectId(entry.projectId)}
                className="rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{entry.projectName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.position.existing} of {entry.position.approvedStrength} on roll ·{' '}
                      {entry.position.underRecruitment} under recruitment
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {entry.position.criticalShortage > 0 && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 tabular-nums text-rose-800">
                        {entry.position.criticalShortage} critical
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-2">
                  <HrMeter label={entry.position.status} percent={entry.position.fulfilmentPercent} />
                </div>
              </button>
            ))}
          </div>
        </HrSection>
      )}

      <HrSection
        title={selected ? `${selected.projectName} — by designation` : 'All designations'}
        description="Spec section 61 — drill down to the role that is actually short."
      >
        <HrDataList
          rows={detailRows}
          columns={columns}
          rowClassName={row => (row.position.criticalShortage > 0 ? 'bg-rose-50/40' : undefined)}
          empty={
            <HrEmptyState
              icon={Building2}
              title="No project manpower to show"
              description="Add project plan lines in Manpower Planning, or raise project requirements, and this fills in."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/hr/manpower/planning">Open manpower planning</Link>
                </Button>
              }
            />
          }
        />
      </HrSection>
    </div>
  );
}
