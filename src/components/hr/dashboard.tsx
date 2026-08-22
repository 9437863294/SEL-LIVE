'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSignature,
  ThumbsDown,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HR_COLLECTIONS,
  PENDING_APPROVAL_STATUSES,
  averageTimeToHire,
  dayDifference,
  evaluateRequirementSla,
  isOpenRequirementStatus,
  isRecruitingStatus,
  summarizeHiringFunnel,
  summarizeRequirementAgeing,
  summarizeRequirementFill,
  type CandidateApplication,
  type HrOffer,
  type HrRequirement,
  type JoiningRecord,
} from '@/lib/hr-requirement';
import {
  HrBarList,
  HrEmptyState,
  HrFunnel,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  HrSection,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The HR dashboard of spec section 3, which exists to answer one question: how many people do we
 * need, where, and what is stopping us from hiring them?
 *
 * Every figure here is derived from the collections rather than read from a stored aggregate, so the
 * dashboard cannot drift from the register. That costs a full read of the organisation's
 * requirements and applications, which for a requisition volume measured in hundreds a year is the
 * right trade: a KPI that is occasionally wrong is worse than one that takes another moment.
 */

export default function HrDashboard() {
  const { departments, projects, settings, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);

  const [departmentId, setDepartmentId] = useState('all');
  const [projectId, setProjectId] = useState('all');

  const scopedRequirements = useMemo(
    () =>
      requirements
        .filter(row => (departmentId === 'all' ? true : row.departmentId === departmentId))
        .filter(row => (projectId === 'all' ? true : row.projectId === projectId)),
    [requirements, departmentId, projectId],
  );

  const requirementIds = useMemo(() => new Set(scopedRequirements.map(row => row.id)), [scopedRequirements]);

  const scoped = useMemo(
    () => ({
      applications: applications.filter(row => requirementIds.has(row.requirementId)),
      offers: offers.filter(row => requirementIds.has(row.requirementId)),
      joinings: joinings.filter(row => requirementIds.has(row.requirementId)),
    }),
    [applications, offers, joinings, requirementIds],
  );

  const stats = useMemo(() => {
    const open = scopedRequirements.filter(row => isOpenRequirementStatus(row.status));

    const fills = open.map(requirement =>
      summarizeRequirementFill({
        requestedQuantity: requirement.requestedQuantity,
        joinedCount: requirement.joinedCount,
        offerAcceptedCount: requirement.offerAcceptedCount,
        offeredCount: requirement.offeredCount,
        inPipelineCount: requirement.applicationCount,
        cancelledPositions: requirement.cancelledPositions,
      }),
    );

    const slaStates = open.map(requirement =>
      evaluateRequirementSla({
        startedAt: requirement.slaStartedAt?.toDate?.() || null,
        targetDays: requirement.slaTargetDays || settings.sla.targets[requirement.priority] || settings.sla.targets.Normal,
        heldDays: requirement.slaHeldDays,
        pauseOnHold: settings.sla.pauseOnHold,
      }),
    );

    const monthStart = new Date();
    monthStart.setDate(1);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const inThisMonth = (value: string | undefined) => {
      if (!value) return false;
      const date = new Date(value);
      return date >= monthStart && date < monthEnd;
    };

    return {
      openRequirements: open.length,
      positionsRequired: fills.reduce((sum, fill) => sum + fill.effectiveRequired, 0),
      positionsFilled: fills.reduce((sum, fill) => sum + fill.joined, 0),
      balancePositions: fills.reduce((sum, fill) => sum + fill.balance, 0),
      critical: open.filter(row => row.priority === 'Critical').length,
      pendingApproval: scopedRequirements.filter(row => PENDING_APPROVAL_STATUSES.includes(row.status)).length,
      recruitingNow: scopedRequirements.filter(row => isRecruitingStatus(row.status)).length,
      offersReleased: scoped.offers.filter(row => ['SENT', 'VIEWED'].includes(row.status)).length,
      joiningAwaited: scoped.joinings.filter(row =>
        ['CONFIRMED', 'CONFIRMATION_PENDING', 'DOCUMENTS_PENDING', 'POSTPONED'].includes(row.status),
      ).length,
      overSla: slaStates.filter(state => state.state === 'Overdue').length,
      joiningThisMonth: scoped.joinings.filter(row => inThisMonth(row.revisedJoiningDate || row.plannedJoiningDate)).length,
      offerRejections: scoped.offers.filter(row => row.status === 'REJECTED').length,
      onHold: scopedRequirements.filter(row => row.status === 'ON_HOLD').length,
      unassigned: open.filter(row => !row.primaryRecruiterId).length,
    };
  }, [scopedRequirements, scoped, settings]);

  const funnel = useMemo(() => summarizeHiringFunnel(scoped.applications), [scoped.applications]);

  const timeToHire = useMemo(
    () =>
      averageTimeToHire(
        scoped.joinings
          .filter(row => row.status === 'JOINED')
          .map(row => {
            const requirement = scopedRequirements.find(entry => entry.id === row.requirementId);
            return {
              approvedAt: requirement?.approvedAt?.toDate?.() || null,
              joinedAt: row.actualJoiningDate || null,
            };
          }),
      ),
    [scoped.joinings, scopedRequirements],
  );

  const byDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const requirement of scopedRequirements) {
      if (!isOpenRequirementStatus(requirement.status)) continue;
      const fill = summarizeRequirementFill({
        requestedQuantity: requirement.requestedQuantity,
        joinedCount: requirement.joinedCount,
        cancelledPositions: requirement.cancelledPositions,
      });
      const name = requirement.departmentName || 'Unassigned';
      map.set(name, (map.get(name) || 0) + fill.balance);
    }
    return Array.from(map, ([label, value]) => ({ label, value }))
      .filter(row => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [scopedRequirements]);

  const byProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const requirement of scopedRequirements) {
      if (!isOpenRequirementStatus(requirement.status) || !requirement.projectName) continue;
      const fill = summarizeRequirementFill({
        requestedQuantity: requirement.requestedQuantity,
        joinedCount: requirement.joinedCount,
        cancelledPositions: requirement.cancelledPositions,
      });
      map.set(requirement.projectName, (map.get(requirement.projectName) || 0) + fill.balance);
    }
    return Array.from(map, ([label, value]) => ({ label, value }))
      .filter(row => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [scopedRequirements]);

  const ageing = useMemo(
    () =>
      summarizeRequirementAgeing(
        scopedRequirements
          .filter(row => isOpenRequirementStatus(row.status))
          .map(row => {
            const created = row.createdAt?.toDate?.();
            const fill = summarizeRequirementFill({
              requestedQuantity: row.requestedQuantity,
              joinedCount: row.joinedCount,
              cancelledPositions: row.cancelledPositions,
            });
            return {
              ageDays: created ? Math.max(0, dayDifference(created, new Date())) : 0,
              balance: fill.balance,
            };
          }),
      ),
    [scopedRequirements],
  );

  const recruiterWorkload = useMemo(() => {
    const map = new Map<string, number>();
    for (const requirement of scopedRequirements) {
      if (!isRecruitingStatus(requirement.status)) continue;
      const name = requirement.primaryRecruiterName || 'Unassigned';
      map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [scopedRequirements]);

  if (loading || configLoading) return <HrLoader label="Loading the HR dashboard…" />;

  const offerAcceptance = funnel.offerAcceptanceRate;

  return (
    <div>
      <HrPageHeader
        title="HR Dashboard"
        description="Manpower demand, recruitment progress and what is holding hiring up."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/hr/tasks">My HR tasks</Link>
            </Button>
            {permissions.can('Add', 'Requirements') && (
              <Button asChild>
                <Link href="/hr/requirements/new">New requirement</Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-2/3">
        <div>
          <Label className="text-xs">Department</Label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All departments</SelectItem>
              {departments.map(department => (
                <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All projects</SelectItem>
              {projects.map(project => (
                <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Section 3's KPI cards. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <HrKpiCard label="Open requirements" value={stats.openRequirements} icon={ClipboardList} tone="blue" href="/hr/requirements" />
        <HrKpiCard label="Positions required" value={stats.positionsRequired} icon={Briefcase} tone="indigo" />
        <HrKpiCard label="Positions filled" value={stats.positionsFilled} icon={BadgeCheck} tone="emerald" />
        <HrKpiCard label="Balance positions" value={stats.balancePositions} icon={Users} tone="amber" />
        <HrKpiCard label="Critical requirements" value={stats.critical} icon={AlertTriangle} tone="rose" />
        <HrKpiCard label="Pending approval" value={stats.pendingApproval} icon={ClipboardCheck} tone="orange" href="/hr/approvals" />
        <HrKpiCard label="Recruitment in progress" value={stats.recruitingNow} icon={TrendingUp} tone="violet" />
        <HrKpiCard label="Offers released" value={stats.offersReleased} icon={FileSignature} tone="teal" href="/hr/offers" />
        <HrKpiCard label="Joining awaited" value={stats.joiningAwaited} icon={UserPlus} tone="cyan" href="/hr/joining" />
        <HrKpiCard
          label="Requirements over SLA"
          value={stats.overSla}
          icon={Clock}
          tone="rose"
          href="/hr/reports/sla"
          hint={stats.overSla ? 'Escalated per the ladder' : undefined}
        />
        <HrKpiCard label="Joining this month" value={stats.joiningThisMonth} icon={CalendarCheck} tone="emerald" />
        <HrKpiCard label="Offer rejections" value={stats.offerRejections} icon={ThumbsDown} tone="slate" />
      </div>

      {scopedRequirements.length === 0 ? (
        <HrEmptyState
          icon={ClipboardList}
          title="No requirements yet"
          description="Raise the first manpower requirement, or set up the manpower plan so requisitions can be checked against a sanctioned strength."
          action={
            <div className="flex gap-2">
              {permissions.can('Add', 'Requirements') && (
                <Button asChild size="sm">
                  <Link href="/hr/requirements/new">New requirement</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href="/hr/manpower/planning">Manpower planning</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HrSection title="Hiring funnel" description="Conversion at each stage of spec section 22.">
            {funnel.total === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No candidates in the pipeline yet.</p>
            ) : (
              <>
                <HrFunnel stages={funnel.stages} />
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Offer acceptance</p>
                    <p className="text-sm font-semibold text-slate-800">{offerAcceptance}%</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Joining conversion</p>
                    <p className="text-sm font-semibold text-slate-800">{funnel.joiningConversionRate}%</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg time to hire</p>
                    <p className="text-sm font-semibold text-slate-800">{timeToHire ? `${timeToHire}d` : '—'}</p>
                  </div>
                </div>
              </>
            )}
          </HrSection>

          <HrSection title="Requirement ageing" description="Open positions by how long they have been waiting.">
            <HrBarList
              rows={ageing.map(row => ({
                label: `${row.bucket} days`,
                value: row.positions,
                hint: `${row.requirements} ${row.requirements === 1 ? 'requirement' : 'requirements'}`,
              }))}
              tone="amber"
              valueLabel={value => `${value} positions`}
              emptyLabel="No open positions."
            />
          </HrSection>

          <HrSection title="Balance positions by department" description="Where the shortage actually sits.">
            <HrBarList rows={byDepartment} tone="indigo" valueLabel={value => `${value} open`} />
          </HrSection>

          <HrSection
            title="Balance positions by project"
            description="Project manpower control has the full breakdown."
            actions={
              <Button asChild size="sm" variant="ghost" className="gap-1.5">
                <Link href="/hr/manpower/project">
                  <Building2 className="h-3.5 w-3.5" /> Open
                </Link>
              </Button>
            }
          >
            <HrBarList rows={byProject} tone="emerald" valueLabel={value => `${value} open`} emptyLabel="No project requirements open." />
          </HrSection>

          <HrSection title="Recruiter workload" description="Live requirements per recruiter.">
            <HrBarList
              rows={recruiterWorkload}
              tone="indigo"
              valueLabel={value => `${value} ${value === 1 ? 'requirement' : 'requirements'}`}
              emptyLabel="No requirements are being recruited yet."
            />
            {stats.unassigned > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                {stats.unassigned} approved {stats.unassigned === 1 ? 'requirement has' : 'requirements have'} no recruiter
                assigned.{' '}
                <Link href="/hr/requirements" className="font-medium underline">
                  Assign one
                </Link>
                .
              </p>
            )}
          </HrSection>

          <HrSection title="Where requirements are stuck" description="The things that stop hiring, in order.">
            <div className="space-y-2">
              {[
                { label: 'Awaiting approval', value: stats.pendingApproval, href: '/hr/approvals' },
                { label: 'Approved but unassigned', value: stats.unassigned, href: '/hr/requirements' },
                { label: 'On hold', value: stats.onHold, href: '/hr/requirements' },
                { label: 'Over SLA', value: stats.overSla, href: '/hr/reports/sla' },
                { label: 'Offers awaiting a response', value: stats.offersReleased, href: '/hr/offers' },
                { label: 'Documents pending before joining', value: stats.joiningAwaited, href: '/hr/pre-joining' },
              ]
                .filter(row => row.value > 0)
                .map(row => (
                  <Link
                    key={row.label}
                    href={row.href}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                  >
                    <span className="text-sm text-slate-700">{row.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-800">{row.value}</span>
                  </Link>
                ))}
              {stats.pendingApproval + stats.unassigned + stats.onHold + stats.overSla === 0 && (
                <p className="py-6 text-center text-sm text-emerald-700">Nothing is blocked. Hiring is moving.</p>
              )}
            </div>
          </HrSection>
        </div>
      )}
    </div>
  );
}
