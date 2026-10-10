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
  isRecordLocked,
  resolveMonthClosure,
  validateAgainstClosure,
  validateRecordChange,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
import {
  RULES_LOADING,
  RULES_UNAVAILABLE,
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

/** Where one of the two rule documents is: still arriving, here, or failed to arrive. */
type RuleState = 'loading' | 'ready' | 'error';

export interface DateControl {
  settings: SASDateControlSettings;
  /** The range anyone may pick for this record type. The same for every user. */
  window: DateWindow;
  /**
   * A short hint for under the date field, or null when unrestricted.
   *
   * Describes the all-projects calendar, which is what the field can say before a project has
   * even been chosen. A project's own exception shows up in the submit-time message, which is
   * where it can be precise about which site it is talking about.
   */
  hint: string | null;
  /**
   * Submit-time check for a *new* record's date. `min`/`max` on an input is only a hint.
   *
   * `projectId` matters: a month can be closed for one site and open for another, so the answer
   * is only correct once the project is known.
   */
  check: (date: string, projectId?: string) => DateCheck;
  /**
   * True when a stored record sits in a month closed for its project, so nothing about it may
   * change.
   *
   * Row actions use this to disable themselves. Disabling is the courtesy; `checkChange` below is
   * the rule, and both pages call it.
   */
  isLocked: (date: string | undefined | null, projectId?: string) => boolean;
  /** Submit-time check for editing or deleting a record that already exists. */
  checkChange: (args: {
    originalDate: string | undefined | null;
    nextDate?: string | null;
    action: 'edit' | 'delete';
    originalProjectId?: string;
    /** Set when the edit also reassigns the record to a different project. */
    nextProjectId?: string;
  }) => DateCheck;
  /** Frozen accounting periods, `YYYY-MM`, oldest first, for one project or the organisation. */
  closedPeriodsFor: (projectId?: string) => string[];
  /** True until both rule documents have arrived. Submit checks refuse while this holds. */
  loading: boolean;
  /** True when either rule document failed to load. Submit checks refuse while this holds. */
  unavailable: boolean;
}

/**
 * The date rules for one kind of record: the back-dating window and the closed months.
 *
 * The same for every user. Neither rule consults a role — no permission widens the window and
 * none opens a closed month. An administrator who needs an older entry recorded changes the
 * window in Settings → Date Control or reopens the month in Settings → Month Closure, both of which
 * everyone can see and both of which leave a record.
 *
 * Fails closed. The state starts from defaults that say "unrestricted", so answering a submit
 * before the real settings have arrived — or after they failed to — would wave through exactly the
 * entries these rules exist to stop. `check` and `checkChange` refuse until both documents are in.
 */
export function useDateControl(kind: SASDatedRecord): DateControl {
  const [settings, setSettings] = useState<SASDateControlSettings>(() => resolveDateControl(null));
  /*
   * The closure document as stored, not as resolved.
   *
   * Months now close themselves on their trigger day, so the same document means different things
   * on different days. Keeping the raw data and resolving it for the current day — below, and
   * again at the moment of each check — is what lets a page left open overnight lock September at
   * midnight on the 5th without anything having to be written.
   */
  const [closureRaw, setClosureRaw] = useState<Partial<SASMonthClosureSettings> | null>(null);
  const [windowState, setWindowState] = useState<RuleState>('loading');
  const [closureState, setClosureState] = useState<RuleState>('loading');

  /*
   * `today` for the date input's `min`/`max`. Re-read every minute so a form left open past
   * midnight moves its bounds with the calendar.
   *
   * The submit-time check does not use this — it reads the clock at the moment of the check. An
   * earlier version captured the date once at mount, which let a form opened at 23:50 accept a
   * date that had fallen out of the window ten minutes later.
   */
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const id = setInterval(() => {
      const now = todayLocal();
      setToday(prev => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_DATE_CONTROL_DOC_ID),
      (snapshot) => {
        // A document that does not exist is a real answer — nobody has configured the window —
        // and resolves to "off". Only a failed read is unknown.
        setSettings(resolveDateControl(snapshot.data() as Partial<SASDateControlSettings> | undefined));
        setWindowState('ready');
      },
      () => setWindowState('error'),
    );
  }, []);

  /*
   * Month closure rides along on the same hook rather than getting one of its own.
   *
   * Every surface that writes a dated record already calls this — the expenses page, the receipts
   * page and the dashboard's quick-add — so folding the frozen periods in here means the lock
   * cannot be forgotten on a form, which is exactly how a half-enforced period control ends up
   * worse than none.
   */
  useEffect(() => {
    return onSnapshot(
      doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
      (snapshot) => {
        setClosureRaw((snapshot.data() as Partial<SASMonthClosureSettings> | undefined) ?? null);
        setClosureState('ready');
      },
      () => setClosureState('error'),
    );
  }, []);

  const loading = windowState === 'loading' || closureState === 'loading';
  const unavailable = windowState === 'error' || closureState === 'error';

  /** The closure as it stands today, refreshed with the minute tick so padlocks appear on time. */
  const closure = useMemo(() => resolveMonthClosure(closureRaw, today), [closureRaw, today]);

  /** The refusal to give while the rules are not known, or null once they are. */
  function unresolved(): DateCheck | null {
    if (unavailable) return RULES_UNAVAILABLE;
    if (loading) return RULES_LOADING;
    return null;
  }

  const window = useMemo(
    () => resolveDateWindow({ settings, kind, today }),
    [settings, kind, today],
  );

  const hint = useMemo(() => {
    const windowHint = describeDateWindow(window, settings);
    const frozen = listClosedPeriods(closure);
    if (frozen.length === 0) return windowHint;
    const closedHint = frozen.length === 1
      ? `${frozen[0]} is closed`
      : `${frozen.length} months are closed`;
    return windowHint ? `${windowHint} · ${closedHint}` : closedHint;
  }, [window, settings, closure]);

  function check(date: string, projectId?: string): DateCheck {
    const pending = unresolved();
    if (pending) return pending;
    const now = todayLocal();
    // The rolling window first: when both would reject, its message is the more actionable one,
    // since it names a date the person can actually use.
    const windowCheck = validateEntryDate({ date, settings, kind, today: now });
    if (!windowCheck.ok) return windowCheck;
    // Resolved for this exact moment rather than taken from the memo, so a submit made a few
    // seconds after midnight on a trigger day is judged against the month as it now is.
    return validateAgainstClosure({ date, settings: resolveMonthClosure(closureRaw, now), kind, projectId });
  }

  return {
    settings,
    window,
    hint,
    check,
    isLocked: (date, projectId) => isRecordLocked({ date, settings: closure, projectId }),
    checkChange: ({ originalDate, nextDate, action, originalProjectId, nextProjectId }) => {
      const pending = unresolved();
      if (pending) return pending;
      return validateRecordChange({
        originalDate, nextDate, settings: resolveMonthClosure(closureRaw, todayLocal()),
        kind, action, originalProjectId, nextProjectId,
      });
    },
    closedPeriodsFor: (projectId) => listClosedPeriods(closure, projectId),
    loading,
    unavailable,
  };
}
