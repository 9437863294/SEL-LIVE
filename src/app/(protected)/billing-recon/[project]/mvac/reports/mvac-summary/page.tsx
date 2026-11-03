'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { collection, getDocs, doc, getDoc, query } from 'firebase/firestore';
import { AlertTriangle, Ban, BarChart3, CheckCircle2, FileCheck2, Truck, IndianRupee, Info, Users } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import type { MvacEntry, User, WorkflowStep, ActionLog } from '@/lib/types';
import { personOptionLabel } from '@/lib/people-directory';
import { withDesignations } from '@/lib/people-directory-client';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BrSection, BR_TONE } from '@/components/billing-recon/page-kit';
import { WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';
import { formatAmountCompact, toIsoDate } from '@/lib/billing-recon/lines';

interface StepWiseReportData {
  [stepName: string]: {
    [userName: string]: {
      total: number;
      completed: number;
      rejected: number;
    };
  };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: (i + 1).toString(),
  label: new Date(2000, i, 1).toLocaleString('en-GB', { month: 'long' }),
}));

/** Year and month (1–12, as text) of a MVAC date — yyyy-mm-dd text or a Timestamp — or null. */
function dateParts(value: unknown): { year: string; month: string } | null {
  const iso = toIsoDate(value);
  return iso ? { year: iso.slice(0, 4), month: String(Number(iso.slice(5, 7))) } : null;
}

const lines = (task: { items?: unknown }): any[] => (Array.isArray(task.items) ? task.items : []);

const computeExecutedValue = (items: any[]) =>
  items.reduce((sum, it) => {
    const rate = Number(it?.rate ?? 0);
    const qty = Number(it?.executedQty ?? 0);
    return sum + (Number.isFinite(rate * qty) ? rate * qty : 0);
  }, 0);

const computeCertifiedValue = (items: any[]) =>
  items.reduce((sum, it) => {
    const value = (Number(it?.certifiedQty) || 0) * (Number(it?.rate) || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? amount : 0
  );

export default function MvacSummaryPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };
  const { currentProject, register: reg, loading: projectsLoading } = useBillingReconProjects();
  const projectId = currentProject?.id ?? '';
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [allTasks, setAllTasks] = useState<MvacEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflow, setWorkflow] = useState<{ steps: WorkflowStep[] } | null>(null);

  const [filters, setFilters] = useState({
    year: 'all',
    month: 'all',
    applicant: 'all',
  });

  const canViewPage = can('View Reports', 'Billing Recon.MVAC');

  const fetchSummaryData = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const [tasksSnapshot, usersSnapshot, workflowDoc] = await Promise.all([
        getDocs(query(collection(db, 'projects', projectId, reg.mvacEntries))),
        getDocs(collection(db, 'users')),
        getDoc(doc(db, WORKFLOWS_COLLECTION, reg.mvacWorkflowId)),
      ]);

      setAllTasks(tasksSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MvacEntry)));
      setUsers(await withDesignations(usersSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as User))));

      const data = workflowDoc.exists() ? (workflowDoc.data() as { steps?: unknown }) : null;
      setWorkflow(data ? { steps: (Array.isArray(data.steps) ? data.steps : []) as WorkflowStep[] } : null);
    } catch (error) {
      console.error('Error fetching summary data: ', error);
      setLoadFailed(true);
      toast({ title: 'Error', description: 'Could not load the MVAC summary.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, reg.mvacEntries, reg.mvacWorkflowId, toast]);

  useEffect(() => {
    if (!isAuthLoading) {
      if (canViewPage) {
        fetchSummaryData();
      } else {
        setIsLoading(false);
      }
    }
  }, [isAuthLoading, canViewPage, fetchSummaryData]);

  const filteredTasks = useMemo(() => {
    let items = allTasks;

    if (filters.year !== 'all') {
      items = items.filter((task) => dateParts((task as any).mvacDate)?.year === filters.year);
    }
    if (filters.month !== 'all') {
      items = items.filter((task) => dateParts((task as any).mvacDate)?.month === filters.month);
    }
    if (filters.applicant !== 'all') {
      const firstActorId = (task: MvacEntry) =>
        Array.isArray(task.history) && task.history.length > 0 ? task.history[0]?.userId : null;
      items = items.filter((task) => firstActorId(task) === filters.applicant);
    }

    return items;
  }, [filters, allTasks]);

  const summaryStats = useMemo(
    () => ({
      totalMVACs: filteredTasks.length,
      totalExecutedValue: filteredTasks.reduce((sum, task) => sum + computeExecutedValue(lines(task)), 0),
      totalCertifiedValue: filteredTasks.reduce((sum, task) => sum + computeCertifiedValue(lines(task)), 0),
      rejected: filteredTasks.filter((task) => task.status === 'Rejected').length,
      completed: filteredTasks.filter((task) => task.status === 'Completed').length,
    }),
    [filteredTasks]
  );

  const stepWiseReport = useMemo((): StepWiseReportData => {
    if (!workflow || !users.length || !filteredTasks.length) {
      return {};
    }

    const report: StepWiseReportData = {};
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    // Manually add a "Created" step at the beginning
    const allSteps = [{ id: 'created', name: 'Created' }, ...workflow.steps];

    allSteps.forEach((step) => {
      report[step.name] = {};
    });

    const initializeUserInStep = (stepName: string, userName: string) => {
      if (!report[stepName]) report[stepName] = {};
      if (!report[stepName][userName]) {
        report[stepName][userName] = { total: 0, completed: 0, rejected: 0 };
      }
    };

    const isCompletionAction = (action: string) => ['approve', 'complete', 'verified'].includes(String(action ?? '').toLowerCase());

    filteredTasks.forEach((task) => {
      const history: ActionLog[] = Array.isArray((task as any).history) ? (task as any).history : [];

      // Handle "Created" stage
      const creationLog = history.find((h) => h?.action === 'Created');
      if (creationLog) {
        const creatorName = userMap.get(creationLog.userId) || 'Unknown User';
        initializeUserInStep('Created', creatorName);
        report['Created'][creatorName].total++;
        report['Created'][creatorName].completed++; // Creation is always a "completed" action for this stage
      }

      // Handle workflow stages
      const stepAssignments: { [stepName: string]: string } = {};

      workflow.steps.forEach((step) => {
        const stepLogs = history.filter((h) => h?.stepName === step.name);
        const assigneeLog = stepLogs.find((l) => l.userId); // First user to act on this step is the assignee

        if (assigneeLog) {
          stepAssignments[step.name] = assigneeLog.userId;
        } else if (task.currentStepId === step.id && task.assignees?.length > 0) {
          // If it's the current step, the assignee is known
          stepAssignments[step.name] = task.assignees[0];
        }
      });

      Object.entries(stepAssignments).forEach(([stepName, userId]) => {
        const userName = userMap.get(userId) || 'Unknown User';
        initializeUserInStep(stepName, userName);

        report[stepName][userName].total++;

        const completionLog = history.find((h) => h?.stepName === stepName && isCompletionAction(h.action));
        const rejectionLog = history.find((h) => h?.stepName === stepName && String(h.action ?? '').toLowerCase() === 'reject');

        if (completionLog) {
          report[stepName][userName].completed++;
        }
        if (rejectionLog) {
          report[stepName][userName].rejected++;
        }
      });
    });

    return report;
  }, [filteredTasks, workflow, users]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const r of allTasks) {
      const parts = dateParts((r as any).mvacDate);
      if (parts) years.add(parts.year);
    }
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [allTasks]);

  const applicantOptions = useMemo(() => {
    const applicantIds = new Set(
      allTasks
        .map((r) => (Array.isArray(r.history) && r.history.length > 0 ? r.history[0]?.userId : null))
        .filter(Boolean)
    );
    return users.filter((u) => applicantIds.has(u.id));
  }, [allTasks, users]);

  const handleFilterChange = (filterName: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [filterName]: value }));
  };

  const activeFilters = Object.values(filters).filter((v) => v !== 'all').length;
  const stepCards = [{ id: 'created', name: 'Created' }, ...(workflow?.steps || [])]
    .map((step) => ({ step, rows: Object.entries(stepWiseReport[step.name] ?? {}).filter(([, d]) => d.total > 0 || d.completed > 0 || d.rejected > 0) }))
    .filter((card) => card.rows.length > 0);

  /* ---------- states ---------- */
  if (isAuthLoading || projectsLoading) return <BrPageSkeleton kpis={5} />;
  if (!canViewPage) return <BrAccessDenied message="You don't have permission to view MVAC reports." />;

  const header = (
    <PageHeader
      title="MVAC Summary"
      description="How many MVACs were raised, their value, and who handled each workflow step."
      icon={BarChart3}
      backHref={`/billing-recon/${projectSlug}/mvac/reports`}
      backLabel="Back to MVAC reports"
    />
  );

  if (!currentProject) {
    return (
      <BrPage tone={BR_TONE.mvac}>
        {header}
        <BrNotice tone="warning" icon={AlertTriangle} title="Project not found">
          No project matches this address. Choose a project from the switcher at the top of the menu.
        </BrNotice>
      </BrPage>
    );
  }

  if (isLoading) return <BrPageSkeleton kpis={5} blocks={1} />;

  return (
    <BrPage tone={BR_TONE.mvac}>
      {header}

      <FilterBar
        activeCount={activeFilters}
        onClear={() => setFilters({ year: 'all', month: 'all', applicant: 'all' })}
        summary={`${filteredTasks.length} of ${allTasks.length} MVAC${allTasks.length === 1 ? '' : 's'}`}
      >
        <Select value={filters.year} onValueChange={(val) => handleFilterChange('year', val)}>
          <SelectTrigger className="text-left" aria-label="Year"><SelectValue placeholder="All Years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={year}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.month} onValueChange={(val) => handleFilterChange('month', val)}>
          <SelectTrigger className="text-left" aria-label="Month"><SelectValue placeholder="All Months" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {MONTHS.map((month) => (
              <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.applicant} onValueChange={(val) => handleFilterChange('applicant', val)}>
          <SelectTrigger className="min-w-0 text-left sm:max-w-[16rem]" aria-label="Raised by"><SelectValue placeholder="All Applicants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Applicants</SelectItem>
            {applicantOptions.map((user) => (
              <SelectItem key={user.id} value={user.id}>{personOptionLabel(user)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {loadFailed && (
        <BrNotice tone="danger" icon={AlertTriangle} title="The summary couldn't be loaded">
          Check the connection and open the page again.
        </BrNotice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total MVACs" value={summaryStats.totalMVACs.toLocaleString('en-IN')} hint={activeFilters ? 'Matching the filters' : 'On this project'} icon={Truck} tone="amber" accent />
        <KpiCard
          label="MVAC Executed Value"
          value={formatAmountCompact(summaryStats.totalExecutedValue)}
          hint={formatCurrency(summaryStats.totalExecutedValue)}
          icon={IndianRupee}
          tone="indigo"
          accent
        />
        <KpiCard
          label="Total Certified Value"
          value={formatAmountCompact(summaryStats.totalCertifiedValue)}
          hint={formatCurrency(summaryStats.totalCertifiedValue)}
          icon={FileCheck2}
          tone="teal"
          accent
        />
        <KpiCard label="Completed" value={summaryStats.completed.toLocaleString('en-IN')} hint="Through every step" icon={CheckCircle2} tone="emerald" accent />
        <KpiCard
          label="Rejected"
          value={summaryStats.rejected.toLocaleString('en-IN')}
          hint="Stopped at a step"
          icon={Ban}
          tone={summaryStats.rejected ? 'rose' : 'slate'}
          accent
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <BrSection
        title="Step-wise Report"
        description="For each workflow step: how many entries each person handled, finished and rejected."
        icon={Users}
        tone={BR_TONE.mvac}
      >
        {!workflow && !loadFailed && (
          <BrNotice tone="info" icon={Info} title="The MVAC workflow isn't set up">
            Only who raised each MVAC can be shown until the workflow has steps.
          </BrNotice>
        )}
        {stepCards.length === 0 ? (
          <BrNotice tone="info" icon={Info} title={allTasks.length === 0 ? 'No MVACs on this project yet' : 'No MVACs match these filters'}>
            {allTasks.length === 0 ? 'The report fills in as MVACs are raised and approved.' : 'Clear a filter to see more.'}
          </BrNotice>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stepCards.map(({ step, rows }) => (
              <TableCard key={step.id} title={step.name} count={rows.length} noun="user" scroll="natural">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Done</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(([userName, data]) => (
                      <TableRow key={userName}>
                        <TableCell className="max-w-[12rem] truncate" title={userName}>{userName}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{data.rejected}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            ))}
          </div>
        )}
      </BrSection>
    </BrPage>
  );
}
