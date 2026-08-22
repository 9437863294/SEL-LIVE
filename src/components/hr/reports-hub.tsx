'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileBarChart, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  HR_COLLECTIONS,
  averageTimeToHire,
  dayDifference,
  evaluateRequirementSla,
  hrCurrency,
  hrStatusLabel,
  isOpenRequirementStatus,
  summarizeHiringFunnel,
  summarizeManpowerPosition,
  summarizeRecruitmentCost,
  summarizeRequirementAgeing,
  summarizeRequirementFill,
  summarizeSourceEffectiveness,
  timeToHireDays,
  type CandidateApplication,
  type CompensationApproval,
  type HrManpowerPlan,
  type HrOffer,
  type HrRequirement,
  type JoiningRecord,
  type RecruitmentAgency,
  type RecruitmentCost,
  type SelectionProposal,
} from '@/lib/hr-requirement';
import { exportRowsToExcel } from '@/lib/report-excel';
import { HrEmptyState, HrLoader, HrPageHeader, HrSection } from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The seventeen reports of spec section 53, from one registry rather than seventeen screens.
 *
 * Each report declares a title, what it answers, and a builder that returns plain rows keyed by
 * column header. The renderer then handles the table, the search, the totals and the Excel export
 * identically for all of them — which is what stops the twelfth report from formatting a percentage
 * differently to the third, and means adding an eighteenth is a builder rather than a screen.
 *
 * Salary-bearing reports declare `sensitive`, and are hidden entirely from users without the
 * sensitive-data permission (control rule 63.12). Withholding the *columns* would leave a report
 * whose totals do not add up, which is worse than not offering it.
 */

interface ReportContext {
  requirements: HrRequirement[];
  applications: CandidateApplication[];
  offers: HrOffer[];
  joinings: JoiningRecord[];
  plans: HrManpowerPlan[];
  costs: RecruitmentCost[];
  agencies: RecruitmentAgency[];
  proposals: SelectionProposal[];
  compensation: CompensationApproval[];
  slaTargets: Record<string, number>;
  pauseOnHold: boolean;
}

interface ReportDefinition {
  slug: string;
  title: string;
  purpose: string;
  group: 'Manpower' | 'Recruitment' | 'Commercial' | 'Control';
  sensitive?: boolean;
  build: (context: ReportContext) => Array<Record<string, string | number>>;
}

const fillOf = (requirement: HrRequirement) =>
  summarizeRequirementFill({
    requestedQuantity: requirement.requestedQuantity,
    joinedCount: requirement.joinedCount,
    offerAcceptedCount: requirement.offerAcceptedCount,
    offeredCount: requirement.offeredCount,
    inPipelineCount: requirement.applicationCount,
    cancelledPositions: requirement.cancelledPositions,
  });

const ageOf = (requirement: HrRequirement) => {
  const created = requirement.createdAt?.toDate?.();
  return created ? Math.max(0, dayDifference(created, new Date())) : 0;
};

const slaOf = (requirement: HrRequirement, context: ReportContext) =>
  evaluateRequirementSla({
    startedAt: requirement.slaStartedAt?.toDate?.() || null,
    targetDays: requirement.slaTargetDays || context.slaTargets[requirement.priority] || context.slaTargets.Normal,
    heldDays: requirement.slaHeldDays,
    pauseOnHold: context.pauseOnHold,
  });

const REPORTS: ReportDefinition[] = [
  {
    slug: 'requirement-register',
    title: 'Requirement Register',
    purpose: 'Complete requisition history.',
    group: 'Manpower',
    build: context =>
      context.requirements.map(requirement => {
        const fill = fillOf(requirement);
        return {
          'Requirement ID': requirement.requirementNumber,
          Date: requirement.requirementDate,
          Department: requirement.departmentName,
          Project: requirement.projectName || '',
          Location: requirement.location || '',
          Designation: requirement.designation,
          Grade: requirement.grade,
          Type: requirement.requirementType,
          Priority: requirement.priority,
          Required: fill.effectiveRequired,
          Joined: fill.joined,
          Balance: fill.balance,
          'Requested By': requirement.requestingManagerName,
          Recruiter: requirement.primaryRecruiterName || '',
          'Target Date': requirement.targetClosureDate || '',
          'Age (days)': ageOf(requirement),
          Status: hrStatusLabel(requirement.status),
        };
      }),
  },
  {
    slug: 'open-positions',
    title: 'Open Position Report',
    purpose: 'Current vacancies being recruited.',
    group: 'Manpower',
    build: context =>
      context.requirements
        .filter(requirement => isOpenRequirementStatus(requirement.status))
        .map(requirement => {
          const fill = fillOf(requirement);
          return {
            'Requirement ID': requirement.requirementNumber,
            Department: requirement.departmentName,
            Project: requirement.projectName || '',
            Designation: requirement.designation,
            Priority: requirement.priority,
            Required: fill.effectiveRequired,
            'In Pipeline': fill.inPipeline,
            Offered: fill.offered,
            'Offer Accepted': fill.offerAccepted,
            Joined: fill.joined,
            Balance: fill.balance,
            Recruiter: requirement.primaryRecruiterName || 'Unassigned',
            'Required By': requirement.requiredJoiningDate,
            Status: hrStatusLabel(requirement.status),
          };
        })
        .filter(row => Number(row.Balance) > 0),
  },
  {
    slug: 'requirement-ageing',
    title: 'Requirement Ageing',
    purpose: 'Delayed positions, bucketed by age.',
    group: 'Control',
    build: context => {
      const open = context.requirements.filter(requirement => isOpenRequirementStatus(requirement.status));
      const buckets = summarizeRequirementAgeing(
        open.map(requirement => ({ ageDays: ageOf(requirement), balance: fillOf(requirement).balance })),
      );
      return buckets.map(bucket => ({
        'Age Bucket (days)': bucket.bucket,
        Requirements: bucket.requirements,
        'Open Positions': bucket.positions,
      }));
    },
  },
  {
    slug: 'planned-vs-actual',
    title: 'Planned vs Actual Headcount',
    purpose: 'Workforce control against the sanctioned plan.',
    group: 'Manpower',
    build: context => {
      const openByKey = new Map<string, number>();
      for (const requirement of context.requirements) {
        if (!isOpenRequirementStatus(requirement.status)) continue;
        const key = `${requirement.projectId || requirement.departmentId}__${requirement.designation}`.toLowerCase();
        openByKey.set(key, (openByKey.get(key) || 0) + fillOf(requirement).balance);
      }
      return context.plans.map(plan => {
        const key = `${plan.projectId || plan.departmentId}__${plan.designation}`.toLowerCase();
        const position = summarizeManpowerPosition({
          approvedStrength: plan.approvedStrength,
          existing: plan.existingStrength,
          underRecruitment: openByKey.get(key) || 0,
          plannedAdditional: plan.plannedAdditional,
        });
        return {
          'Financial Year': plan.financialYear,
          Department: plan.departmentName || '',
          Project: plan.projectName || '',
          Designation: plan.designation,
          Sanctioned: position.approvedStrength,
          'On Roll': position.existing,
          'Planned Additional': position.plannedAdditional,
          Vacancy: position.shortage,
          'Under Recruitment': position.underRecruitment,
          'Critical Gap': position.criticalShortage,
          'Fulfilment %': position.fulfilmentPercent,
          Position: position.status,
        };
      });
    },
  },
  {
    slug: 'department-vacancy',
    title: 'Department Vacancy',
    purpose: 'Where the shortage sits by department.',
    group: 'Manpower',
    build: context => {
      const map = new Map<string, { requirements: number; required: number; joined: number; balance: number }>();
      for (const requirement of context.requirements) {
        if (!isOpenRequirementStatus(requirement.status)) continue;
        const fill = fillOf(requirement);
        const key = requirement.departmentName || 'Unassigned';
        const entry = map.get(key) || { requirements: 0, required: 0, joined: 0, balance: 0 };
        entry.requirements += 1;
        entry.required += fill.effectiveRequired;
        entry.joined += fill.joined;
        entry.balance += fill.balance;
        map.set(key, entry);
      }
      return Array.from(map, ([department, entry]) => ({
        Department: department,
        Requirements: entry.requirements,
        'Positions Required': entry.required,
        Joined: entry.joined,
        Balance: entry.balance,
        'Fill %': entry.required > 0 ? Math.round((entry.joined / entry.required) * 100) : 0,
      })).sort((a, b) => Number(b.Balance) - Number(a.Balance));
    },
  },
  {
    slug: 'project-vacancy',
    title: 'Project Vacancy',
    purpose: 'Project manpower shortage.',
    group: 'Manpower',
    build: context => {
      const map = new Map<string, { requirements: number; required: number; joined: number; balance: number; critical: number }>();
      for (const requirement of context.requirements) {
        if (!isOpenRequirementStatus(requirement.status) || !requirement.projectName) continue;
        const fill = fillOf(requirement);
        const entry = map.get(requirement.projectName) || { requirements: 0, required: 0, joined: 0, balance: 0, critical: 0 };
        entry.requirements += 1;
        entry.required += fill.effectiveRequired;
        entry.joined += fill.joined;
        entry.balance += fill.balance;
        if (requirement.priority === 'Critical') entry.critical += 1;
        map.set(requirement.projectName, entry);
      }
      return Array.from(map, ([project, entry]) => ({
        Project: project,
        Requirements: entry.requirements,
        'Critical Requirements': entry.critical,
        'Positions Required': entry.required,
        Joined: entry.joined,
        Balance: entry.balance,
      })).sort((a, b) => Number(b.Balance) - Number(a.Balance));
    },
  },
  {
    slug: 'recruitment-funnel',
    title: 'Recruitment Funnel',
    purpose: 'Conversion at each pipeline stage.',
    group: 'Recruitment',
    build: context => {
      const funnel = summarizeHiringFunnel(context.applications);
      return funnel.stages.map(stage => ({
        Stage: stage.label,
        Candidates: stage.count,
        'Conversion from previous %': stage.conversionFromPrevious,
        'Conversion from applied %': stage.conversionFromTop,
      }));
    },
  },
  {
    slug: 'recruiter-performance',
    title: 'Recruiter Performance',
    purpose: 'HR team productivity.',
    group: 'Recruitment',
    build: context => {
      const map = new Map<
        string,
        { requirements: number; positions: number; joined: number; overdue: number; times: number[] }
      >();
      for (const requirement of context.requirements) {
        const name = requirement.primaryRecruiterName || 'Unassigned';
        const entry = map.get(name) || { requirements: 0, positions: 0, joined: 0, overdue: 0, times: [] };
        const fill = fillOf(requirement);
        entry.requirements += 1;
        entry.positions += fill.effectiveRequired;
        entry.joined += fill.joined;
        if (isOpenRequirementStatus(requirement.status) && slaOf(requirement, context).state === 'Overdue') entry.overdue += 1;

        for (const joining of context.joinings) {
          if (joining.requirementId !== requirement.id || joining.status !== 'JOINED') continue;
          const days = timeToHireDays({
            approvedAt: requirement.approvedAt?.toDate?.() || null,
            joinedAt: joining.actualJoiningDate || null,
          });
          if (days !== null) entry.times.push(days);
        }
        map.set(name, entry);
      }
      return Array.from(map, ([recruiter, entry]) => ({
        Recruiter: recruiter,
        Requirements: entry.requirements,
        'Positions Assigned': entry.positions,
        Joined: entry.joined,
        'Fill %': entry.positions > 0 ? Math.round((entry.joined / entry.positions) * 100) : 0,
        'Over SLA': entry.overdue,
        'Avg Time to Hire (days)':
          entry.times.length > 0 ? Math.round(entry.times.reduce((sum, value) => sum + value, 0) / entry.times.length) : 0,
      })).sort((a, b) => Number(b.Joined) - Number(a.Joined));
    },
  },
  {
    slug: 'source-effectiveness',
    title: 'Source Effectiveness',
    purpose: 'Which hiring channels actually deliver.',
    group: 'Recruitment',
    build: context => {
      const costBySource = new Map<string, number>();
      for (const cost of context.costs) {
        // Portal and advertisement spend is what a source-cost comparison is really about.
        const source = cost.head === 'Agency Fee' ? 'Recruitment Agency' : cost.head === 'Job Portal' ? 'Job Portal' : '';
        if (!source) continue;
        costBySource.set(source, (costBySource.get(source) || 0) + (Number(cost.amount) || 0));
      }
      return summarizeSourceEffectiveness(context.applications, Object.fromEntries(costBySource)).map(row => ({
        Source: row.source,
        Applied: row.applied,
        Shortlisted: row.shortlisted,
        Interviewed: row.interviewed,
        Offered: row.offered,
        Joined: row.joined,
        'Yield %': row.yieldPercent,
        'Cost per Join': row.costPerJoin,
      }));
    },
  },
  {
    slug: 'candidate-rejection',
    title: 'Candidate Rejection',
    purpose: 'Why candidates do not proceed.',
    group: 'Recruitment',
    build: context => {
      const map = new Map<string, number>();
      for (const application of context.applications) {
        const exited = ['REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'OFFER_REJECTED', 'NO_SHOW'].includes(application.stage);
        if (!exited) continue;
        const reason = application.exitReason?.trim() || hrStatusLabel(application.stage);
        map.set(reason, (map.get(reason) || 0) + 1);
      }
      const total = Array.from(map.values()).reduce((sum, value) => sum + value, 0);
      return Array.from(map, ([reason, count]) => ({
        Reason: reason,
        Candidates: count,
        'Share %': total > 0 ? Math.round((count / total) * 100) : 0,
      })).sort((a, b) => Number(b.Candidates) - Number(a.Candidates));
    },
  },
  {
    slug: 'offer-acceptance',
    title: 'Offer Acceptance',
    purpose: 'How competitive the offers are.',
    group: 'Recruitment',
    build: context => {
      const map = new Map<string, { sent: number; accepted: number; rejected: number; expired: number }>();
      for (const offer of context.offers) {
        const requirement = context.requirements.find(row => row.id === offer.requirementId);
        const key = requirement?.departmentName || 'Unassigned';
        const entry = map.get(key) || { sent: 0, accepted: 0, rejected: 0, expired: 0 };
        if (['SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'].includes(offer.status)) entry.sent += 1;
        if (offer.status === 'ACCEPTED') entry.accepted += 1;
        if (offer.status === 'REJECTED') entry.rejected += 1;
        if (offer.status === 'EXPIRED') entry.expired += 1;
        map.set(key, entry);
      }
      return Array.from(map, ([department, entry]) => ({
        Department: department,
        'Offers Released': entry.sent,
        Accepted: entry.accepted,
        Declined: entry.rejected,
        Expired: entry.expired,
        'Acceptance %': entry.sent > 0 ? Math.round((entry.accepted / entry.sent) * 100) : 0,
      })).sort((a, b) => Number(b['Offers Released']) - Number(a['Offers Released']));
    },
  },
  {
    slug: 'no-show',
    title: 'No-show Report',
    purpose: 'Joining risk — accepted offers that did not arrive.',
    group: 'Control',
    build: context =>
      context.joinings
        .filter(joining => ['NOT_JOINED', 'OFFER_CANCELLED'].includes(joining.status))
        .map(joining => ({
          Candidate: joining.candidateName,
          Designation: joining.designation,
          Department: joining.departmentName || '',
          Project: joining.projectName || '',
          'Planned Joining': joining.revisedJoiningDate || joining.plannedJoiningDate,
          Outcome: hrStatusLabel(joining.status),
          Reason: joining.notJoinedReason || '',
          Requirement: joining.requirementNumber || '',
        })),
  },
  {
    slug: 'joining-forecast',
    title: 'Joining Forecast',
    purpose: 'Who is arriving, and when.',
    group: 'Recruitment',
    build: context =>
      context.joinings
        .filter(joining => !['JOINED', 'NOT_JOINED', 'OFFER_CANCELLED'].includes(joining.status))
        .map(joining => ({
          'Joining Date': joining.revisedJoiningDate || joining.plannedJoiningDate,
          Candidate: joining.candidateName,
          Designation: joining.designation,
          Grade: joining.grade || '',
          Department: joining.departmentName || '',
          Project: joining.projectName || '',
          Location: joining.location || '',
          'Documents %': joining.documentCompletionPercent || 0,
          Status: hrStatusLabel(joining.status),
        }))
        .sort((a, b) => String(a['Joining Date']).localeCompare(String(b['Joining Date']))),
  },
  {
    slug: 'hiring-cost',
    title: 'Hiring Cost',
    purpose: 'Recruitment spend and cost per hire.',
    group: 'Commercial',
    sensitive: true,
    build: context => {
      const map = new Map<string, { costs: RecruitmentCost[]; joined: number; number: string; designation: string }>();
      for (const cost of context.costs) {
        const key = cost.requirementId || 'unattributed';
        const requirement = context.requirements.find(row => row.id === cost.requirementId);
        const entry = map.get(key) || {
          costs: [],
          joined: requirement ? fillOf(requirement).joined : 0,
          number: requirement?.requirementNumber || 'Unattributed',
          designation: requirement?.designation || '',
        };
        entry.costs.push(cost);
        map.set(key, entry);
      }
      return Array.from(map.values()).map(entry => {
        const summary = summarizeRecruitmentCost(entry.costs, entry.joined);
        return {
          Requirement: entry.number,
          Designation: entry.designation,
          'Positions Joined': summary.joined,
          'Total Cost': summary.total,
          'Cost per Hire': summary.costPerHire,
          'Largest Head': summary.byHead[0]?.head || '',
        };
      }).sort((a, b) => Number(b['Total Cost']) - Number(a['Total Cost']));
    },
  },
  {
    slug: 'ctc-variance',
    title: 'CTC Variance',
    purpose: 'Budget control on what was actually offered.',
    group: 'Commercial',
    sensitive: true,
    build: context =>
      context.proposals.map(proposal => {
        const offer = context.offers.find(row => row.selectionProposalId === proposal.id);
        return {
          Candidate: proposal.candidateName,
          Requirement: proposal.requirementNumber || '',
          Designation: proposal.designation,
          Grade: proposal.grade,
          'Current CTC': proposal.currentCtc || 0,
          'Budgeted CTC': proposal.budgetedCtc || 0,
          'Band Maximum': proposal.bandMax || 0,
          'Proposed CTC': proposal.proposedCtc,
          'Approved CTC': proposal.approvedCtc || 0,
          'Offered CTC': offer?.offeredCtc || 0,
          'Variance vs Band %': proposal.ctcVariancePercent || 0,
          'Increase vs Current %': proposal.increasePercent || 0,
          'Compensation Approval': proposal.compensationApprovalStatus
            ? hrStatusLabel(proposal.compensationApprovalStatus)
            : '',
        };
      }),
  },
  {
    slug: 'agency-performance',
    title: 'Agency Performance',
    purpose: 'Vendor evaluation.',
    group: 'Commercial',
    build: context =>
      context.agencies.map(agency => {
        const submitted = agency.submittedCount || 0;
        return {
          Agency: agency.name,
          Status: agency.status,
          Submitted: submitted,
          Shortlisted: agency.shortlistedCount || 0,
          Interviewed: agency.interviewedCount || 0,
          Offered: agency.offeredCount || 0,
          Joined: agency.joinedCount || 0,
          'Yield %': submitted > 0 ? Math.round(((agency.joinedCount || 0) / submitted) * 100) : 0,
          'Fee Basis': agency.feeType === 'Flat Fee' ? `Flat ${hrCurrency(agency.flatFee)}` : `${agency.feePercent || 0}% of CTC`,
          'Replacement Guarantee (days)': agency.replacementGuaranteeDays || 0,
        };
      }).sort((a, b) => Number(b.Joined) - Number(a.Joined)),
  },
  {
    slug: 'sla',
    title: 'SLA Report',
    purpose: 'Hiring SLA compliance and escalations.',
    group: 'Control',
    build: context =>
      context.requirements
        .filter(requirement => isOpenRequirementStatus(requirement.status))
        .map(requirement => {
          const sla = slaOf(requirement, context);
          const fill = fillOf(requirement);
          return {
            'Requirement ID': requirement.requirementNumber,
            Department: requirement.departmentName,
            Designation: requirement.designation,
            Priority: requirement.priority,
            Recruiter: requirement.primaryRecruiterName || 'Unassigned',
            'Target (days)': sla.targetDays,
            'Age (days)': sla.effectiveAgeDays,
            'Held (days)': sla.heldDays,
            'Consumed %': sla.consumedPercent,
            'Overdue (days)': sla.overdueDays,
            Balance: fill.balance,
            'Escalations Sent': (requirement.escalationsSent || []).join(', '),
            'SLA State': sla.state,
          };
        })
        .sort((a, b) => Number(b['Consumed %']) - Number(a['Consumed %'])),
  },
];

export default function ReportsHub({ slug }: { slug?: string }) {
  const { settings, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();

  const { rows: requirements, loading } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);
  const { rows: applications } = useHrCollection<CandidateApplication>(HR_COLLECTIONS.applications);
  const { rows: offers } = useHrCollection<HrOffer>(HR_COLLECTIONS.offers);
  const { rows: joinings } = useHrCollection<JoiningRecord>(HR_COLLECTIONS.joiningRecords);
  const { rows: plans } = useHrCollection<HrManpowerPlan>(HR_COLLECTIONS.manpowerPlans);
  const { rows: costs } = useHrCollection<RecruitmentCost>(HR_COLLECTIONS.costs);
  const { rows: agencies } = useHrCollection<RecruitmentAgency>(HR_COLLECTIONS.agencies);
  const { rows: proposals } = useHrCollection<SelectionProposal>(HR_COLLECTIONS.selectionProposals);
  const { rows: compensation } = useHrCollection<CompensationApproval>(HR_COLLECTIONS.compensationApprovals);

  const [search, setSearch] = useState('');

  const context = useMemo<ReportContext>(
    () => ({
      requirements,
      applications,
      offers,
      joinings,
      plans,
      costs,
      agencies,
      proposals,
      compensation,
      slaTargets: settings.sla.targets,
      pauseOnHold: settings.sla.pauseOnHold,
    }),
    [requirements, applications, offers, joinings, plans, costs, agencies, proposals, compensation, settings],
  );

  const available = useMemo(
    () => REPORTS.filter(report => !report.sensitive || permissions.canViewSalary),
    [permissions.canViewSalary],
  );

  const report = slug ? available.find(entry => entry.slug === slug) : undefined;

  const rows = useMemo(() => {
    if (!report) return [];
    const built = report.build(context);
    const term = search.trim().toLowerCase();
    if (!term) return built;
    return built.filter(row => Object.values(row).join(' ').toLowerCase().includes(term));
  }, [report, context, search]);

  if (loading || configLoading) return <HrLoader label="Loading reports…" />;

  /* ---------- The hub ---------- */
  if (!slug) {
    const groups: Array<ReportDefinition['group']> = ['Manpower', 'Recruitment', 'Commercial', 'Control'];
    return (
      <div>
        <HrPageHeader
          title="Reports"
          description={`${available.length} of ${REPORTS.length} reports available to you`}
        />

        {!permissions.canViewSalary && (
          <p className="mb-4 text-xs text-muted-foreground">
            Reports that carry salary figures are not shown, because they cannot be made meaningful with the
            amounts removed.
          </p>
        )}

        <div className="space-y-4">
          {groups.map(group => {
            const entries = available.filter(entry => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <HrSection key={group} title={group} description={`${entries.length} reports`}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {entries.map(entry => (
                    <Link
                      key={entry.slug}
                      href={`/hr/reports/${entry.slug}`}
                      className="rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                          <FileBarChart className="h-4 w-4 text-indigo-600" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-slate-800">{entry.title}</p>
                            {entry.sensitive && (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                                salary
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.purpose}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </HrSection>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------- A single report ---------- */
  if (!report) {
    return (
      <div>
        <HrPageHeader title="Report not found" />
        <HrEmptyState
          icon={FileBarChart}
          title="That report is not available"
          description="It may need the salary-visibility permission, or the link may be out of date."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/hr/reports">Back to reports</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const headers = Object.keys(rows[0] || {});

  /** Numeric columns get a total row — a report of counts with no total is half a report. */
  const numericHeaders = headers.filter(header => rows.every(row => typeof row[header] === 'number'));
  const totals = Object.fromEntries(
    numericHeaders
      .filter(header => !/%|per|avg|days/i.test(header))
      .map(header => [header, rows.reduce((sum, row) => sum + Number(row[header] || 0), 0)]),
  );

  return (
    <div>
      <HrPageHeader
        title={report.title}
        description={`${report.purpose} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
        actions={
          <>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/hr/reports">
                <ArrowLeft className="h-4 w-4" /> All reports
              </Link>
            </Button>
            {permissions.can('Export', 'Reports') && rows.length > 0 && (
              <Button variant="outline" className="gap-2" onClick={() => exportRowsToExcel(report.title, rows)}>
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 sm:w-80">
        <Label className="text-xs">Search within this report</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter rows…" className="pl-8" />
        </div>
      </div>

      {rows.length === 0 ? (
        <HrEmptyState
          icon={FileBarChart}
          title="Nothing to report yet"
          description="This report fills in as requirements, candidates and joinings are recorded."
        />
      ) : (
        <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map(header => (
                    <TableHead key={header} className={cn(numericHeaders.includes(header) && 'text-right')}>
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    {headers.map(header => (
                      <TableCell
                        key={header}
                        className={cn('text-sm', numericHeaders.includes(header) && 'text-right tabular-nums')}
                      >
                        {row[header] === '' || row[header] === undefined ? '—' : String(row[header])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {Object.keys(totals).length > 0 && (
                  <TableRow className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    {headers.map((header, index) => (
                      <TableCell key={header} className={cn('text-sm', numericHeaders.includes(header) && 'text-right tabular-nums')}>
                        {index === 0 ? 'Total' : totals[header] !== undefined ? totals[header] : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Slugs of every report, so the route can validate a URL without importing the whole registry. */
export const HR_REPORT_SLUGS = REPORTS.map(report => report.slug);
