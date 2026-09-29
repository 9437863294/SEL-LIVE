'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileBarChart, FilePlus, Files, Settings } from 'lucide-react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';

import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { DailyWorkflowCard, dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import {
  DAILY_REQUISITION_BASE,
  dailyRequisitionAccess,
  dailyStageIcon,
  dailyStepSlug,
  useDailyRequisitionWorkflowSteps,
} from '@/components/daily-requisition/nav';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';

/* ─── helpers ─── */

/** Pick an accent gradient based on dynamic step index */
const dynamicStepAccents = [
  'bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-300',
  'bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400',
  'bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300',
];
function getDynamicStepAccent(index: number): string {
  return dynamicStepAccents[index] ?? 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500';
}

/** Short descriptions for each dynamic step position. */
function getDynamicStepDescription(index: number, name: string): string {
  switch (index) {
    case 0:
      return 'Receive entries and move them into finance review.';
    case 1:
      return 'Verify deductions and prepare the payment-ready amount.';
    case 2:
      return 'Track entries that are ready for final payment action.';
    default:
      return `Manage entries at the "${name}" stage.`;
  }
}

/**
 * What is still open at each stage, by position: every status that stage's page lists except the
 * finished ones (Cancelled at receiving, Paid at payment). Mirrors `getStepConfig` in
 * `[step]/page.tsx`, which is also position-based — keep the two in step.
 */
const STAGE_OPEN_STATUSES: string[][] = [
  ['Pending'],
  ['Received', 'Verified', 'Needs Review'],
  ['Received for Payment', 'Partially Paid'],
];

/* ─── static standalone cards (Entry Sheet + support) ─── */

const entrySheetCard = {
  icon: FilePlus,
  title: 'Entry Sheet',
  href: `${DAILY_REQUISITION_BASE}/entry-sheet`,
  description: 'Create and manage daily requisition entries.',
  badge: 'Entry',
  accentClassName: 'bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-400',
};

/* ════════════════════════════════════════════════════════════
   COMPONENT
   ════════════════════════════════════════════════════════════ */

export default function DailyRequisitionPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { steps: workflowSteps, isLoading: stepsLoading } = useDailyRequisitionWorkflowSteps();
  const access = useMemo(() => dailyRequisitionAccess(can), [can]);

  /* ── the stages whose queue this person can see, and so is counted for them ── */
  const countable = useMemo(
    () =>
      isAuthLoading || stepsLoading
        ? []
        : workflowSteps
            .slice(0, STAGE_OPEN_STATUSES.length)
            .map((step, index) => ({ name: step.name, statuses: STAGE_OPEN_STATUSES[index] }))
            .filter(({ name }) => access.stage(name)),
    [isAuthLoading, stepsLoading, workflowSteps, access],
  );
  const countKey = countable.map(({ name }) => name).join('\u0000');
  const [counts, setCounts] = useState<{ key: string; values: Record<string, number> } | null>(null);

  useEffect(() => {
    if (countable.length === 0) return;
    let cancelled = false;
    Promise.all(
      countable.map(({ name, statuses }) =>
        getCountFromServer(query(collection(db, 'dailyRequisitions'), where('status', 'in', statuses)))
          .then((snap) => [name, Number(snap.data().count || 0)] as const)
          .catch((error) => {
            // No figure is better than a wrong one: the card simply shows none.
            console.error(`Could not count the "${name}" queue:`, error);
            return null;
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const values: Record<string, number> = {};
      for (const result of results) if (result) values[result[0]] = result[1];
      setCounts({ key: countKey, values });
    });
    return () => {
      cancelled = true;
    };
  }, [countable, countKey]);

  const countsLoaded = counts?.key === countKey;
  const countedStages = new Set(countable.map(({ name }) => name));

  const workflowCards = workflowSteps.map((step, i) => ({
    icon: dailyStageIcon(i),
    title: step.name,
    href: `${DAILY_REQUISITION_BASE}/${dailyStepSlug(step.name)}`,
    description: getDynamicStepDescription(i, step.name),
    badge: `Stage ${i + 1}`,
    accentClassName: getDynamicStepAccent(i),
    disabled: !access.stage(step.name),
    count: countedStages.has(step.name) ? (countsLoaded ? counts?.values[step.name] : null) : undefined,
    countLabel: 'waiting',
  }));

  const supportCards = [
    {
      icon: Files,
      title: 'Manage Documents',
      href: `${DAILY_REQUISITION_BASE}/manage-documents`,
      description: 'Upload, verify, and follow up on supporting documents.',
      badge: 'Support',
      accentClassName: 'bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-400',
      disabled: !access.manageDocuments,
    },
    {
      icon: FileBarChart,
      title: 'Reports',
      href: `${DAILY_REQUISITION_BASE}/reports`,
      description: 'Status overview, trends, department/project analysis, financial breakdown, ageing, and more.',
      badge: 'Reports',
      accentClassName: 'bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-500',
      disabled: !access.reportsHub,
    },
    {
      icon: Settings,
      title: 'Settings',
      href: `${DAILY_REQUISITION_BASE}/settings`,
      description: 'Configure serials, printing, workflow, and module-level controls.',
      badge: 'Admin',
      accentClassName: 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500',
      disabled: !access.settings,
    },
  ];

  const stageCount = workflowCards.length;

  if (isAuthLoading || stepsLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-full max-w-80" />
        <Skeleton className="mb-3 h-6 w-32 rounded-full" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        eyebrow="Daily Requisition"
        title="Daily Requisition"
        description="Create entries, then track them through the workflow stages — from receiving to payment."
        backHref="/"
        meta={
          <Badge variant="neutral">
            {stageCount} workflow stage{stageCount !== 1 ? 's' : ''}
          </Badge>
        }
      />

      {/* ── Entry Sheet — standalone card ── */}
      <div className="mb-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          <FilePlus className="h-3.5 w-3.5" />
          Entry Point
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <DailyWorkflowCard item={{ ...entrySheetCard, disabled: !access.entrySheet }} />
        </div>
      </div>

      {/* ── Workflow stage cards, each with its live queue ── */}
      {workflowCards.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {workflowCards.map((item) => (
              <DailyWorkflowCard key={item.href} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── Support cards ── */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          <Settings className="h-3.5 w-3.5" />
          Support &amp; Admin
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {supportCards.map((item) => (
            <DailyWorkflowCard key={item.title} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
