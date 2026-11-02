'use client';

import Link from 'next/link';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Eye } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  BANK_DASHBOARD_SETTINGS,
  dashboardDesignLabel,
  normaliseDashboardDesign,
  type BankDashboardDesign,
} from '@/lib/bank-balance-dashboard';
import { AccountsDesign } from './accounts-design';
import { AuroraDesign } from './aurora-design';
import type { BankDashboardModel } from './kit';
import { OverviewDesign } from './overview-design';
import { PositionDesign } from './position-design';

export type { BankDashboardModel } from './kit';

/** The stored choice. */
export interface DashboardDesignSetting {
  design: BankDashboardDesign;
  updatedByName?: string;
  updatedAt?: Date | null;
}

const settingRef = () => doc(db, BANK_DASHBOARD_SETTINGS.collection, BANK_DASHBOARD_SETTINGS.id);

/**
 * The company's dashboard design. Never throws: an unreadable or missing document (no rule yet for
 * the viewer, offline) reads as the default, so the dashboard always renders.
 */
export async function readDashboardDesign(): Promise<DashboardDesignSetting> {
  try {
    const snap = await getDoc(settingRef());
    if (!snap.exists()) return { design: normaliseDashboardDesign(undefined) };
    const data = snap.data() as { design?: unknown; updatedByName?: unknown; updatedAt?: { toDate?: () => Date } };
    return {
      design: normaliseDashboardDesign(data.design),
      updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : undefined,
      updatedAt: typeof data.updatedAt?.toDate === 'function' ? data.updatedAt.toDate() : null,
    };
  } catch (error) {
    console.warn('Could not read the Bank Balance dashboard design; showing Classic.', error);
    return { design: normaliseDashboardDesign(undefined) };
  }
}

export async function saveDashboardDesign(design: BankDashboardDesign, by: { id: string; name: string }) {
  await setDoc(
    settingRef(),
    { design, updatedAt: serverTimestamp(), updatedById: by.id, updatedByName: by.name },
    { merge: true },
  );
}

/** The newer designs; Classic is the dashboard page's own markup. */
export function DashboardDesignView({ design, model }: { design: Exclude<BankDashboardDesign, 'classic'>; model: BankDashboardModel }) {
  switch (design) {
    case 'overview':
      return <OverviewDesign model={model} />;
    case 'accounts':
      return <AccountsDesign model={model} />;
    case 'position':
      return <PositionDesign model={model} />;
    case 'aurora':
      return <AuroraDesign model={model} />;
  }
}

/** Shown above a design opened from Settings with `?design=`: nothing is saved by previewing. */
export function DesignPreviewBanner({ previewing, saved }: { previewing: BankDashboardDesign; saved: BankDashboardDesign }) {
  return (
    <div className="mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950 sm:mx-6 lg:mx-8 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
      <Eye aria-hidden className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Previewing <b>{dashboardDesignLabel(previewing)}</b> with today’s figures. Only you see this; everyone else sees{' '}
        <b>{dashboardDesignLabel(saved)}</b>.
      </span>
      <Link href="/bank-balance/settings#dashboard-design" className="shrink-0 font-semibold underline-offset-2 hover:underline">
        Back to settings
      </Link>
    </div>
  );
}
