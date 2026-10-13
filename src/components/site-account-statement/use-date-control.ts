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
  dateRuleFor,
  describeDateWindow,
  projectsWithOwnRule,
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
  /** The all-projects range for this record type. The same for every user. */
  window: DateWindow;
  /** The all-projects hint for under a date field, or null when unrestricted. */
  hint: string | null;
  /**
   * The range for one project — its own Date Control rule when it has one. Forms use this once
   * a project is chosen, so the picker offers exactly the dates the submit check will accept.
   */
  windowFor: (projectId?: string | null) => DateWindow;
  /** The hint for one project: its window and its closed months. */
  hintFor: (projectId?: string | null) => string | null;
  /** Import preview check, before the row's project is known — see the implementation. */
  checkAnyProject: (date: string) => DateCheck;
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

  function windowFor(projectId?: string | null): DateWindow {
    return resolveDateWindow({ settings, kind, projectId, today });
  }

  function hintFor(projectId?: string | null): string | null {
    const windowHint = describeDateWindow(windowFor(projectId), dateRuleFor(settings, projectId));
    const frozen = listClosedPeriods(closure, projectId ?? undefined);
    if (frozen.length === 0) return windowHint;
    const closedHint = frozen.length === 1
      ? `${frozen[0]} is closed`
      : `${frozen.length} months are closed`;
    return windowHint ? `${windowHint} · ${closedHint}` : closedHint;
  }

  const hint = hintFor();

  /**
   * For an import preview, which sees a date before it knows the row's project: passes when the
   * all-projects rule or any project's own rule would accept it. Each row's save runs `check` with
   * its project, which is where the date is actually judged.
   */
  function checkAnyProject(date: string): DateCheck {
    const all = check(date);
    if (all.ok) return all;
    return projectsWithOwnRule(settings).some(projectId => check(date, projectId).ok) ? { ok: true } : all;
  }

  function check(date: string, projectId?: string): DateCheck {
    const pending = unresolved();
    if (pending) return pending;
    const now = todayLocal();
    // The rolling window first: when both would reject, its message is the more actionable one,
    // since it names a date the person can actually use. It is the project's own rule when it has one.
    const windowCheck = validateEntryDate({ date, settings, kind, projectId, today: now });
    if (!windowCheck.ok) return windowCheck;
    // Resolved for this exact moment rather than taken from the memo, so a submit made a few
    // seconds after midnight on a trigger day is judged against the month as it now is.
    return validateAgainstClosure({ date, settings: resolveMonthClosure(closureRaw, now), kind, projectId });
  }

  return {
    settings,
    window,
    hint,
    windowFor,
    hintFor,
    checkAnyProject,
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
