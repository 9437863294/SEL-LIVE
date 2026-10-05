'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  SAS_COLLECTIONS,
  SAS_DATE_CONTROL_DOC_ID,
  SAS_MONTH_CLOSURE_DOC_ID,
} from '@/lib/site-account-statement';
import {
  closedPeriods as listClosedPeriods,
  resolveMonthClosure,
  validateAgainstClosure,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
import {
  describeDateWindow,
  resolveDateControl,
  resolveDateWindow,
  todayLocal,
  validateEntryDate,
  type DateCheck,
  type DateWindow,
  type SASDateControlSettings,
  type SASDatedRecord,
} from '@/lib/site-account-statement-date-policy';
import { useAuthorization } from '@/hooks/useAuthorization';

const MODULE = 'Site Account Statement';

export interface DateControl {
  settings: SASDateControlSettings;
  /** The range this user may pick for this record type. */
  window: DateWindow;
  /** True when the user holds `Backdated Entry` and the window does not apply to them. */
  canBypass: boolean;
  /** A short hint for under the date field, or null when unrestricted. */
  hint: string | null;
  /** Submit-time check. The form must call this — `min`/`max` on an input is only a hint. */
  check: (date: string) => DateCheck;
  /** Frozen accounting periods, `YYYY-MM`, oldest first. Empty when the user may post into them. */
  closedPeriods: string[];
  /** True when the user holds `Month Closure` / `Close` and closed months do not stop them. */
  canPostToClosedMonths: boolean;
  loading: boolean;
}

/**
 * Live back-dating rule for one kind of record.
 *
 * Subscribes to the org-wide Date Control document and combines it with the caller's
 * `Backdated Entry` permission. Holders of that permission — and of All Projects, who administer
 * the module — are never restricted.
 *
 * `today` is captured once per mount rather than read on every render, so a form left open across
 * midnight cannot start rejecting the date already typed into it. A page reload picks up the new
 * day, which is the right granularity for a rule measured in days.
 */
export function useDateControl(kind: SASDatedRecord): DateControl {
  const { can } = useAuthorization();
  const [settings, setSettings] = useState<SASDateControlSettings>(() => resolveDateControl(null));
  const [closure, setClosure] = useState<SASMonthClosureSettings>(() => resolveMonthClosure(null));
  const [loading, setLoading] = useState(true);
  const [today] = useState(todayLocal);

  useEffect(() => {
    // No `setLoading(true)` here — the state already starts true and this effect runs once, so
    // setting it synchronously inside the effect would only add a cascading render.
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID),
      (snapshot) => {
        setSettings(resolveDateControl(snapshot.data() as Partial<SASDateControlSettings> | undefined));
        setLoading(false);
      },
      // A read failure must not lock people out of recording work. Falling back to the resolved
      // defaults leaves `enabled` false, i.e. unrestricted.
      () => setLoading(false),
    );
  }, []);

  /*
   * Month closure rides along on the same hook rather than getting one of its own.
   *
   * Every surface that writes a dated record already calls this — the expenses page, the receipts
   * page and the dashboard's quick-add — so folding the frozen periods in here means the lock
   * cannot be forgotten on a form, which is exactly how a half-enforced period control ends up
   * worse than none.
   *
   * A read failure leaves nothing closed, matching the Date Control fallback: an outage must not
   * stop a site recording its work.
   */
  useEffect(() => {
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
      (snapshot) => setClosure(resolveMonthClosure(snapshot.data() as Partial<SASMonthClosureSettings> | undefined)),
      () => { /* leave nothing closed */ },
    );
  }, []);

  const canBypass =
    can('Add', `${MODULE}.Backdated Entry`) ||
    can('Edit', `${MODULE}.Backdated Entry`) ||
    can('View', `${MODULE}.All Projects`);

  const window = useMemo(
    () => resolveDateWindow({ settings, kind, canBypass, today }),
    [settings, kind, canBypass, today],
  );

  /*
   * Closing a period is not the same authority as back-dating within an open one, so
   * `Backdated Entry` deliberately does not unlock a closed month. All Projects does, because that
   * is the module's administrator and the person who would otherwise be reopening the month to
   * make the same correction.
   */
  const canPostToClosedMonths =
    can('Close', `${MODULE}.Month Closure`) ||
    can('View', `${MODULE}.All Projects`);

  const hint = useMemo(() => {
    const windowHint = describeDateWindow(window, settings);
    if (canPostToClosedMonths) return windowHint;
    const frozen = listClosedPeriods(closure);
    if (frozen.length === 0) return windowHint;
    const closedHint = frozen.length === 1
      ? `${frozen[0]} is closed`
      : `${frozen.length} months are closed`;
    return windowHint ? `${windowHint} · ${closedHint}` : closedHint;
  }, [window, settings, closure, canPostToClosedMonths]);

  function check(date: string): DateCheck {
    // The rolling window first: when both would reject, its message is the more actionable one,
    // since it names a date the person can actually use.
    const windowCheck = validateEntryDate({ date, settings, kind, canBypass, today });
    if (!windowCheck.ok) return windowCheck;
    return validateAgainstClosure({ date, settings: closure, kind, canOverride: canPostToClosedMonths });
  }

  return {
    settings,
    window,
    canBypass,
    hint,
    check,
    closedPeriods: canPostToClosedMonths ? [] : listClosedPeriods(closure),
    canPostToClosedMonths,
    loading,
  };
}
