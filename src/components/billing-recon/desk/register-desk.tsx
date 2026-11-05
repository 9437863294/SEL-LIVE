'use client';

/**
 * The JMC / MVAC desk — a register's landing page, in the order a reader needs it: the figures
 * (entries, open, overdue, value executed / certified / awaiting certification), then one work
 * queue per workflow step, then the register's actions, then the latest entries.
 *
 * Two reads, for the project the Billing Recon shell resolved from the URL:
 *  - the workflow document its register names — the project's JMC workflow (its own once
 *    separated, the shared one until then) or the fixed MVAC workflow;
 *  - the register's entries, `billingReconRegister(project).jmcEntries` / `.mvacEntries`.
 *
 * Used by `billing-recon/[project]/jmc/page.tsx` and `.../mvac/page.tsx`.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  ClipboardList,
  FilePlus,
  GitMerge,
  HardHat,
  History,
  Hourglass,
  Inbox,
  IndianRupee,
  ListChecks,
  Plus,
  RefreshCw,
  Settings,
  Timer,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard, type Tone } from '@/components/shared/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { useAuth } from '@/components/auth/AuthProvider';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import {
  ActionCard,
  BrAccessDenied,
  BrNotice,
  BrPage,
  BrPageSkeleton,
  BrSection,
  BR_TONE,
  type BrTone,
} from '@/components/billing-recon/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { WORKFLOWS_COLLECTION, registerLabel } from '@/lib/billing-recon/register';
import { entryValues, percent, summarizeProject, toMillis, type DashboardEntry } from '@/lib/billing-recon/dashboard';
import { formatAmount, formatAmountCompact, formatIsoDate } from '@/lib/billing-recon/lines';
import { readWorkflowSteps } from '@/lib/billing-recon/workflow-steps';
import { statusTone } from '@/lib/status-tone';
import type { WorkflowStep } from '@/lib/types';

export type RegisterKind = 'JMC' | 'MVAC';

interface KindConfig {
  segment: string;
  resource: string;
  createAction: string;
  /** MVAC's checks have always passed the project as the permission scope; JMC's never have. */
  scoped: boolean;
  icon: LucideIcon;
  tone: BrTone;
  kpiTone: Tone;
  title: string;
  description: string;
  createDescription: string;
}

const KIND: Record<RegisterKind, KindConfig> = {
  JMC: {
    segment: 'jmc',
    resource: 'Billing Recon.JMC',
    createAction: 'Create JMC Entry',
    scoped: false,
    icon: HardHat,
    tone: BR_TONE.jmc,
    kpiTone: 'orange',
    title: 'JMC Management',
    description: "Joint Measurement Certificates: what's waiting at each stage, and what's been executed and certified.",
    createDescription: 'Raise a Joint Measurement Certificate against the BOQ.',
  },
  MVAC: {
    segment: 'mvac',
    resource: 'Billing Recon.MVAC',
    createAction: 'Create MVAC Entry',
    scoped: true,
    icon: Truck,
    tone: BR_TONE.mvac,
    kpiTone: 'amber',
    title: 'MVAC Management',
    description: "MVAC certificates: what's waiting at each stage, and what's been executed and certified.",
    createDescription: 'Raise an MVAC certificate against the BOQ.',
  },
};

/** An entry as read here: the dashboard fields plus where it sits in the workflow. */
type DeskEntry = DashboardEntry & { currentStepId?: unknown; assignees?: unknown };

interface DeskData {
  /** The project / register / workflow the data belongs to. */
  baseKey: string;
  /** The refresh count it was read at. */
  refresh: number;
  /** When it was read — "overdue" is measured against this, so renders stay pure. */
  at: number;
  steps: WorkflowStep[];
  workflowError: string | null;
  entries: DeskEntry[];
  entriesError: string | null;
}

interface RecentRow {
  id: string;
  number: string;
  date: string;
  stage: string;
  status: string;
  value: number;
}

const CLOSED = new Set(['completed', 'certified', 'rejected', 'cancelled', 'canceled']);
const DONE = new Set(['completed', 'certified']);
const VOID = new Set(['rejected', 'cancelled', 'canceled']);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
const statusOf = (entry: DeskEntry) => text(entry.status) || 'Pending';
const isOpen = (entry: DeskEntry) => !CLOSED.has(statusOf(entry).toLowerCase());

/** "Certified" is the best outcome here, though the app-wide vocabulary doesn't know the word. */
const entryTone = (status: string): StatusTone => (status.toLowerCase() === 'certified' ? 'success' : statusTone(status));

/** The workflow's steps, defensively: named steps only, each with an id (the menu's stage links use the same rule). */
function readSteps(raw: unknown, kind: RegisterKind): WorkflowStep[] {
  return readWorkflowSteps<WorkflowStep>(raw, kind);
}

function stepLine(step: WorkflowStep, index: number, count: number): string {
  const parts = [`Step ${index + 1} of ${count}`];
  const tat = Number(step.tat);
  if (Number.isFinite(tat) && tat > 0) parts.push(`${tat} h turnaround`);
  if (step.assignmentType) parts.push(step.assignmentType);
  return parts.join(' · ');
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function RegisterDesk({ kind }: { kind: RegisterKind }) {
  const cfg = KIND[kind];
  const { toast } = useToast();
  const params = useParams<{ project: string }>();
  const projectSlug = params?.project ?? '';
  const base = `/billing-recon/${projectSlug}/${cfg.segment}`;

  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { can, isLoading: authLoading } = useAuthorization();
  const { currentProject, register, loading: projectsLoading } = useBillingReconProjects();

  /* ---------- permissions (the same checks each hub made) ---------- */
  const scope = cfg.scoped ? projectSlug : undefined;
  const allowed = (action: string) => {
    if (authLoading) return false;
    try {
      return can(action, cfg.resource, scope);
    } catch {
      return false;
    }
  };
  const canViewModule = allowed('View');
  const canCreate = allowed(cfg.createAction);
  const canViewLog = allowed('View Log');
  const canViewReports = allowed('View Reports');
  const canViewSettings = allowed('View Settings');
  const canViewStages = allowed('View');

  /* ---------- reads ---------- */
  const projectId = currentProject?.id ?? '';
  const workflowId = kind === 'JMC' ? register.jmcWorkflowId : register.mvacWorkflowId;
  const entriesCollection = kind === 'JMC' ? register.jmcEntries : register.mvacEntries;
  const baseKey = `${kind}|${projectId}|${workflowId}|${entriesCollection}`;
  const ready = !authLoading && !projectsLoading && canViewModule && Boolean(projectId);

  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<DeskData | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const run = async () => {
      const [workflowResult, entriesResult] = await Promise.allSettled([
        getDoc(doc(db, WORKFLOWS_COLLECTION, workflowId)),
        getDocs(collection(db, 'projects', projectId, entriesCollection)),
      ]);
      if (cancelled) return;

      let steps: WorkflowStep[] = [];
      let workflowError: string | null = null;
      if (workflowResult.status === 'fulfilled') {
        const snap = workflowResult.value;
        steps = readSteps(snap.exists() ? snap.data()?.steps : [], kind);
      } else {
        console.error('Failed to fetch workflow steps:', workflowResult.reason);
        workflowError = 'Failed to load workflow configuration.';
        toast({ title: 'Could not load workflow', description: 'Please try again later.', variant: 'destructive' });
      }

      let entries: DeskEntry[] = [];
      let entriesError: string | null = null;
      if (entriesResult.status === 'fulfilled') {
        entries = entriesResult.value.docs.map((d) => ({ id: d.id, ...d.data() }) as DeskEntry);
      } else {
        console.error(`Failed to fetch ${kind} entries:`, entriesResult.reason);
        entriesError = `The ${kind} entries could not be read, so the figures and queues below are blank.`;
      }

      setData({ baseKey, refresh, at: Date.now(), steps, workflowError, entries, entriesError });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, baseKey, refresh, kind, workflowId, projectId, entriesCollection, toast]);

  const current = data && data.baseKey === baseKey ? data : null;
  const refreshing = Boolean(current && current.refresh !== refresh);
  const steps = useMemo(() => current?.steps ?? [], [current]);
  const entries = useMemo(() => current?.entries ?? [], [current]);
  const at = current?.at ?? 0;

  /* ---------- figures ---------- */
  const summary = useMemo(
    () => summarizeProject({ jmcEntries: kind === 'JMC' ? entries : [], mvacEntries: kind === 'MVAC' ? entries : [], bills: [] }, at),
    [entries, kind, at],
  );
  const outcome = useMemo(() => {
    let done = 0;
    let voided = 0;
    for (const e of entries) {
      const s = statusOf(e).toLowerCase();
      if (DONE.has(s)) done += 1;
      else if (VOID.has(s)) voided += 1;
    }
    return { done, voided };
  }, [entries]);

  /* ---------- stage queues ---------- */
  const queues = useMemo(() => {
    const byStep = new Map<string, { open: number; overdue: number; mine: number }>();
    const stepIds = new Set(steps.map((s) => s.id));
    let unplaced = 0;
    for (const e of entries) {
      if (!isOpen(e)) continue;
      const stepId = text(e.currentStepId);
      if (!stepIds.has(stepId)) {
        unplaced += 1;
        continue;
      }
      const q = byStep.get(stepId) ?? { open: 0, overdue: 0, mine: 0 };
      q.open += 1;
      const deadline = toMillis(e.deadline);
      if (deadline !== null && deadline < at) q.overdue += 1;
      if (userId && Array.isArray(e.assignees) && e.assignees.includes(userId)) q.mine += 1;
      byStep.set(stepId, q);
    }
    return { byStep, unplaced };
  }, [entries, steps, at, userId]);

  /* ---------- latest entries ---------- */
  const recent = useMemo<RecentRow[]>(() => {
    const stepName = new Map(steps.map((s) => [s.id, s.name]));
    const dateOf = (e: DeskEntry) => (kind === 'JMC' ? e.jmcDate : e.mvacDate);
    const when = (e: DeskEntry) => toMillis(e.createdAt) ?? toMillis(dateOf(e)) ?? 0;
    return [...entries]
      .sort((a, b) => when(b) - when(a))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        number: text(kind === 'JMC' ? e.jmcNo : e.mvacNo) || '—',
        date: formatIsoDate(dateOf(e)),
        stage: text(e.stage) || stepName.get(text(e.currentStepId)) || '—',
        status: statusOf(e),
        value: entryValues(e).executed,
      }));
  }, [entries, steps, kind]);

  const columns: Array<ListColumn<RecentRow>> = [
    { header: `${kind} No.`, cell: (r) => <span className="font-medium text-foreground">{r.number}</span>, mobile: 'title' },
    { header: 'Date', cell: (r) => <span className="whitespace-nowrap">{r.date}</span> },
    {
      header: 'Stage',
      cell: (r) => (
        <span className="block max-w-[16rem] truncate" title={r.stage}>
          {r.stage}
        </span>
      ),
    },
    { header: 'Status', cell: (r) => <StatusBadge status={r.status} tone={entryTone(r.status)} />, mobile: 'aside' },
    { header: 'Value', cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatAmount(r.value)}</span>, align: 'right' },
  ];

  /* ---------- rendering ---------- */
  if (authLoading || projectsLoading) return <BrPageSkeleton kpis={6} blocks={2} />;
  if (!canViewModule) return <BrAccessDenied message={`You do not have permission to access ${kind} management.`} />;

  if (!currentProject) {
    return (
      <BrPage tone={cfg.tone}>
        <PageHeader title={cfg.title} icon={cfg.icon} />
        <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
          This link does not match any project. It may have been renamed or removed — pick the project again from the switcher.
        </BrNotice>
      </BrPage>
    );
  }

  if (!current) return <BrPageSkeleton kpis={6} blocks={2} />;

  const { workflowError, entriesError } = current;
  const blank = Boolean(entriesError);
  const count = (n: number) => (blank ? '—' : n);
  const money = (n: number) => (blank ? '—' : formatAmountCompact(n));
  const { executed, certified, awaitingCertification } = summary.values;
  const open = summary.pending.length;
  const overdue = summary.overdueCount;

  return (
    <BrPage tone={cfg.tone}>
      <PageHeader
        eyebrow={currentProject.projectName}
        title={cfg.title}
        description={cfg.description}
        icon={cfg.icon}
        meta={[{ label: 'Register', value: registerLabel(currentProject) }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setRefresh((n) => n + 1)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              Refresh
            </Button>
            {canCreate && (
              <Button asChild>
                <Link href={`${base}/entry`}>
                  <Plus className="mr-2 h-4 w-4" />
                  New {kind}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {entriesError && (
        <BrNotice tone="danger" icon={AlertTriangle} title={`Couldn't read the ${kind} entries`}>
          {entriesError}
        </BrNotice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          label="All entries"
          value={count(entries.length)}
          hint={blank ? undefined : `${outcome.done} done · ${outcome.voided} rejected or cancelled`}
          icon={ListChecks}
          tone={cfg.kpiTone}
          accent
        />
        <KpiCard
          label="Open"
          value={count(open)}
          hint={blank ? undefined : open ? 'Waiting at a workflow stage' : 'Nothing waiting'}
          icon={Inbox}
          tone="blue"
          accent
        />
        <KpiCard
          label="Overdue"
          value={count(overdue)}
          hint={blank ? undefined : overdue ? 'Past the stage deadline' : 'Nothing past its deadline'}
          icon={Timer}
          tone={!blank && overdue ? 'rose' : 'emerald'}
          accent
        />
        <KpiCard
          label="Executed value"
          value={money(executed)}
          hint={blank ? undefined : formatAmount(executed)}
          icon={IndianRupee}
          tone="indigo"
          accent
        />
        <KpiCard
          label="Certified value"
          value={money(certified)}
          hint={blank ? undefined : `${percent(certified, executed)}% of executed`}
          icon={BadgeCheck}
          tone="emerald"
          accent
        />
        <KpiCard
          label="Awaiting certification"
          value={money(awaitingCertification)}
          hint={blank ? undefined : 'Executed − certified'}
          icon={Hourglass}
          tone={!blank && awaitingCertification > 0 ? 'amber' : 'emerald'}
          accent
        />
      </div>

      <BrSection
        title="Stage queues"
        description="Open entries at each workflow step. Open a queue to act on the ones assigned to you."
        icon={GitMerge}
        tone={cfg.tone}
      >
        {workflowError ? (
          <BrNotice tone="danger" icon={AlertTriangle} title="Workflow unavailable">
            {workflowError}
          </BrNotice>
        ) : steps.length === 0 ? (
          <BrNotice
            tone="warning"
            icon={GitMerge}
            title="No stages configured"
            action={
              canViewSettings ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}/settings/workflow-configuration`}>Configure workflow</Link>
                </Button>
              ) : undefined
            }
          >
            {kind} entries move through the steps of this workflow, and it has none yet.{' '}
            {canViewSettings ? 'Set them up in Settings › Workflow Configuration.' : 'Ask someone with settings access to set them up.'}
          </BrNotice>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {steps.map((step, index) => {
              const q = queues.byStep.get(step.id) ?? { open: 0, overdue: 0, mine: 0 };
              return (
                <ActionCard
                  key={step.id}
                  href={`${base}/stage/${step.id}`}
                  title={step.name}
                  description={stepLine(step, index, steps.length)}
                  icon={GitMerge}
                  tone={cfg.tone}
                  figure={blank ? '—' : q.open}
                  figureLabel={plural(q.open, 'open entry', 'open entries')}
                  alert={!blank && q.overdue > 0 ? <StatusBadge tone="danger" dot>{q.overdue} overdue</StatusBadge> : undefined}
                  badge={!blank && q.mine > 0 ? <StatusBadge tone="info">{q.mine} assigned to you</StatusBadge> : undefined}
                  disabled={!canViewStages}
                  disabledReason="No permission to view stages"
                />
              );
            })}
          </div>
        )}
        {!workflowError && !blank && steps.length > 0 && queues.unplaced > 0 && (
          <BrNotice
            tone="warning"
            icon={AlertTriangle}
            title={`${queues.unplaced} open ${plural(queues.unplaced, 'entry is', 'entries are')} in no queue`}
            action={
              canViewLog ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}/log`}>Open log</Link>
                </Button>
              ) : undefined
            }
          >
            {plural(queues.unplaced, 'It sits', 'They sit')} at a step this workflow no longer has, or at none, so no stage page lists{' '}
            {plural(queues.unplaced, 'it', 'them')}.
          </BrNotice>
        )}
      </BrSection>

      <BrSection title={`${kind} register`} description="Raise, review, report and configure." icon={ClipboardList} tone={cfg.tone}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ActionCard
            href={`${base}/entry`}
            title={`Create ${kind}`}
            description={cfg.createDescription}
            icon={FilePlus}
            tone={cfg.tone}
            disabled={!canCreate}
            disabledReason="No permission to create entries"
          />
          <ActionCard
            href={`${base}/log`}
            title={`${kind} Log`}
            description="Every entry with its lines and history — view, print and manage."
            icon={History}
            tone="slate"
            figure={count(entries.length)}
            figureLabel={plural(entries.length, 'entry', 'entries')}
            disabled={!canViewLog}
            disabledReason="No permission to view the log"
          />
          <ActionCard
            href={`${base}/reports`}
            title="Reports"
            description="Totals, executed and certified value, and each step's work by person."
            icon={BarChart3}
            tone="violet"
            disabled={!canViewReports}
            disabledReason="No permission to view reports"
          />
          <ActionCard
            href={`${base}/settings`}
            title="Settings"
            description="Workflow steps and number series."
            icon={Settings}
            tone="slate"
            figure={workflowError ? '—' : steps.length}
            figureLabel={plural(steps.length, 'workflow step', 'workflow steps')}
            disabled={!canViewSettings}
            disabledReason="No permission to view settings"
          />
        </div>
      </BrSection>

      <TableCard
        title="Latest entries"
        description={`The ${kind} entries raised most recently, newest first.`}
        icon={History}
        scroll="natural"
        actions={
          canViewLog && entries.length > recent.length ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/log`}>All {entries.length} in the log</Link>
            </Button>
          ) : undefined
        }
      >
        <DataList
          rows={recent}
          columns={columns}
          dense
          empty={
            <p className="py-10 text-center text-sm text-muted-foreground">
              {blank ? 'Entries could not be read.' : `No ${kind} entries yet.`}
            </p>
          }
        />
      </TableCard>
    </BrPage>
  );
}
