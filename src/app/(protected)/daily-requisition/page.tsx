'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  FilePlus,
  Landmark,
  Receipt,
  Settings,
  Files,
  Banknote,
  Sparkles,
  ArrowRight,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { WorkflowStep } from '@/lib/types';
import {
  DailyMetricCard,
  DailyPageHeader,
  DailyWorkflowCard,
  dailyPageContainerClass,
} from '@/components/daily-requisition/module-shell';
import { Skeleton } from '@/components/ui/skeleton';

/* ─── helpers ─── */

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Pick an icon based on dynamic step index (0-based, Entry Sheet excluded) */
const dynamicStepIcons: LucideIcon[] = [Landmark, Receipt, Banknote];
function getDynamicStepIcon(index: number): LucideIcon {
  return dynamicStepIcons[index] ?? Workflow;
}

/** Pick an accent gradient based on dynamic step index */
const dynamicStepAccents = [
  'bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-300',
  'bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400',
  'bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300',
];
function getDynamicStepAccent(index: number): string {
  return dynamicStepAccents[index] ?? 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500';
}

/* ─── static standalone cards (Entry Sheet + support) ─── */

const entrySheetCard = {
  icon: FilePlus,
  title: 'Entry Sheet',
  href: '/daily-requisition/entry-sheet',
  description: 'Create and manage daily requisition entries.',
  permission: 'View',
  badge: 'Entry',
  accentClassName: 'bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-400',
} as const;

const supportItems = [
  {
    icon: Files,
    title: 'Manage Documents',
    href: '/daily-requisition/manage-documents',
    description: 'Upload, verify, and follow up on supporting documents.',
    permission: 'View',
    badge: 'Support',
    accentClassName: 'bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-400',
  },
  {
    icon: Settings,
    title: 'Settings',
    href: '/daily-requisition/settings',
    description: 'Configure serials, printing, workflow, and module-level controls.',
    permission: 'View',
    badge: 'Admin',
    accentClassName: 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500',
  },
] as const;

/* ════════════════════════════════════════════════════════════
   COMPONENT
   ════════════════════════════════════════════════════════════ */

export default function DailyRequisitionPage() {
  const { can } = useAuthorization();
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /* ── fetch workflow config ── */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'workflows', 'daily-requisition-workflow'));
        if (snap.exists()) {
          const data = snap.data();
          setWorkflowSteps(data.steps || []);
        }
      } catch (err) {
        console.error('Error loading workflow config for dashboard:', err);
      }
      setIsLoading(false);
    })();
  }, []);

  /* ── dynamic workflow stages (all steps in config are dynamic) ── */
  const dynamicSteps = useMemo(() => workflowSteps, [workflowSteps]);

  const workflowCards = useMemo(() => {
    return dynamicSteps.map((step, i) => ({
      icon: getDynamicStepIcon(i),
      title: step.name,
      href: `/daily-requisition/${toSlug(step.name)}`,
      description: getDynamicStepDescription(i, step.name),
      permission: 'View' as const,
      badge: `Stage ${i + 1}`,
      accentClassName: getDynamicStepAccent(i),
    }));
  }, [dynamicSteps]);

  /* ── assemble all cards: Entry Sheet → Workflow Stages → Support ── */
  const allItems = [entrySheetCard, ...workflowCards, ...supportItems];

  const dashboardItems = allItems.map((item) => ({
    ...item,
    disabled: !can(item.permission, `Daily Requisition.${item.title}`),
  }));

  const enabledCount = dashboardItems.filter((item) => !item.disabled).length;
  const stageCount = workflowCards.length;

  /* ── short descriptions for each dynamic step position ── */
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

  if (isLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-6 h-10 w-80" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
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
      <DailyPageHeader
        title="Daily Requisition"
        description="Create entries, then track them through the workflow stages — from receiving to payment."
        backHref="/"
        meta={
          <>
            <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur">
              {stageCount} workflow stage{stageCount !== 1 ? 's' : ''}
            </span>
            <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              {enabledCount} accessible areas
            </span>
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <DailyMetricCard label="Workflow Stages" value={stageCount} hint="Receiving to payment" />
        <DailyMetricCard label="Support Areas" value={3} hint="Entry, documents & settings" />
        <DailyMetricCard label="Your Access" value={enabledCount} hint="Cards enabled for your role" />
      </div>

      {/* ── Entry Sheet — standalone card ── */}
      <div className="mb-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          <FilePlus className="h-3.5 w-3.5" />
          Entry Point
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <DailyWorkflowCard item={dashboardItems[0]} />
        </div>
      </div>

      {/* ── Workflow stage cards ── */}
      {workflowCards.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {/* dashboardItems[0] is Entry Sheet (already rendered above), so skip it */}
            {dashboardItems.slice(1, 1 + workflowCards.length).map((item) => (
              <DailyWorkflowCard key={item.title} item={item} />
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
          {dashboardItems.slice(1 + workflowCards.length).map((item) => (
            <DailyWorkflowCard key={item.title} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
