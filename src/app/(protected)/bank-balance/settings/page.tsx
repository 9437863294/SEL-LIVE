'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { format, subMonths } from 'date-fns';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { BankAccessDenied, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import { BankSettingsHub } from '@/components/bank-balance/settings-hub';
import { readDashboardDesign } from '@/components/bank-balance/dashboard-designs';
import { BANK_DASHBOARD_DESIGNS, dashboardDesignLabel } from '@/lib/bank-balance-dashboard';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { BB_CONTROL_DOCS, BB_SETTINGS_COLLECTION, resolveBBDateControl, type BBDateControlSettings } from '@/lib/bank-balance-entry-controls';
import type { BBFieldControlDoc } from '@/lib/bank-balance-field-registry';
import { settingsOverview, type SettingsOverview } from '@/lib/bank-balance-settings-overview';
import { localToday, resolveMonthClosure, type SASMonthClosureSettings } from '@/lib/site-account-statement-month-closure';
import type { BankAccount } from '@/lib/types';

/**
 * Bank Balance › Settings: reads what every card reports, once, and hands it to the hub
 * (src/components/bank-balance/settings-hub.tsx). See `settingsOverview` for what each card says.
 */
export default function BankBalanceSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const canViewPage = can('View Module', 'Bank Balance');
  const [overview, setOverview] = useState<SettingsOverview | null>(null);

  // Everything the cards report, read once. Each source fails on its own: a card it feeds says
  // "Not available" rather than taking the page down.
  useEffect(() => {
    if (isLoading || !canViewPage) return;
    let cancelled = false;
    void (async () => {
      const today = new Date();
      const lastMonth = format(subMonths(today, 1), 'yyyy-MM');
      const settingsDoc = (id: string) => getDoc(doc(db, BB_SETTINGS_COLLECTION, id));
      const [accountsRes, interestRes, fieldRes, legacyRes, dateRes, closureRes, designRes] = await Promise.allSettled([
        getDocs(collection(db, 'bankAccounts')),
        getDoc(doc(db, 'monthlyInterest', lastMonth)),
        settingsDoc(BB_CONTROL_DOCS.fieldControl),
        settingsDoc('paymentEntry'),
        settingsDoc(BB_CONTROL_DOCS.dateControl),
        settingsDoc(BB_CONTROL_DOCS.monthClosure),
        readDashboardDesign(),
      ]);
      if (cancelled) return;

      const accounts = accountsRes.status === 'fulfilled' ? accountsRes.value.docs.map((d) => ({ id: d.id, ...d.data() } as BankAccount)) : null;
      const cc = (accounts ?? []).filter((a) => a.status === 'Active' && a.accountType === 'Cash Credit');
      // Entered counts as "some account has a non-zero actual" — the Monthly Interest page saves
      // untouched accounts as 0.
      let lastMonthEntered: boolean | null = null;
      if (interestRes.status === 'fulfilled' && accounts) {
        const data = interestRes.value.exists() ? (interestRes.value.data() as Record<string, { actual?: number }>) : null;
        lastMonthEntered = cc.length === 0 ? true : !!data && cc.some((account) => (Number(data[account.id]?.actual) || 0) > 0);
      }
      const fieldControl =
        fieldRes.status === 'fulfilled'
          ? {
              doc: fieldRes.value.exists() ? (fieldRes.value.data() as BBFieldControlDoc) : null,
              updatedAt: (fieldRes.value.data()?.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
            }
          : undefined;
      // A read the rules refuse means "not set up" for these, as on the entry forms.
      const refusedOrEmpty = <T,>(res: PromiseSettledResult<{ data: () => unknown }>, resolve: (raw: unknown) => T): T | undefined =>
        res.status === 'fulfilled' ? resolve(res.value.data()) : String((res.reason as { code?: string })?.code) === 'permission-denied' ? resolve(undefined) : undefined;

      setOverview(
        settingsOverview({
          accounts,
          limitOn: getApplicableCcLimit,
          today,
          lastMonthEntered,
          fieldControl,
          legacyMandatory: legacyRes.status === 'fulfilled' ? ((legacyRes.value.data()?.mandatoryFields as Record<string, unknown> | undefined) ?? null) : null,
          dateControl: refusedOrEmpty(dateRes, (raw) => resolveBBDateControl(raw as Partial<BBDateControlSettings> | undefined)),
          closure: refusedOrEmpty(closureRes, (raw) => resolveMonthClosure(raw as Partial<SASMonthClosureSettings> | null, localToday())),
          dashboardDesign:
            designRes.status === 'fulfilled'
              ? {
                  label: dashboardDesignLabel(designRes.value.design),
                  designs: BANK_DASHBOARD_DESIGNS.length,
                  chosenBy: designRes.value.updatedByName,
                  chosenAt: designRes.value.updatedAt ?? null,
                }
              : undefined,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, canViewPage]);

  if (isLoading) return <BankPageSkeleton kpis={0} />;
  if (!canViewPage) return <BankAccessDenied title="Bank Settings" />;
  return <BankSettingsHub overview={overview} />;
}
