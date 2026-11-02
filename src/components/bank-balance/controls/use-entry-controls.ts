'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BB_CONTROL_DOCS,
  BB_DATE_LABEL,
  BB_SETTINGS_COLLECTION,
  RULES_LOADING,
  RULES_UNAVAILABLE,
  bbDateWindowForAccounts,
  describeBBDateWindow,
  isEntryLocked,
  resolveBBDateControl,
  todayLocal,
  validateBBEntryAgainstClosure,
  validateBBEntryChange,
  validateBBEntryDate,
  type BBDateControlSettings,
  type BBEntryKind,
  type DateCheck,
  type DateWindow,
} from '@/lib/bank-balance-entry-controls';
import { closedPeriods, resolveMonthClosure, type SASMonthClosureSettings } from '@/lib/site-account-statement-month-closure';
import { periodLabel } from '@/lib/site-account-statement-period-range';

type RuleState = 'loading' | 'ready' | 'error';
type AccountIds = Array<string | null | undefined>;

/**
 * A read refused by the database rules means "this viewer may not read the controls", not "the
 * controls are unknown". Until the rule that lets every signed-in user read them is published, a
 * viewer without Payment Entry Settings access gets this refusal — and failing closed would stop
 * them recording anything at all. So a refusal reads as "nothing configured" (logged), while any
 * other failure — offline, a timeout — still fails closed.
 */
const isRefusal = (error: FirestoreError) => error.code === 'permission-denied';

export interface EntryControls {
  settings: BBDateControlSettings;
  /** The dates the picker should offer for these accounts (a transfer's two: their overlap). */
  windowFor: (accountIds?: AccountIds, opts?: { postDated?: boolean }) => DateWindow;
  /** The hint under a date field: the window and how many months are closed, or null. */
  hintFor: (accountIds?: AccountIds, opts?: { postDated?: boolean }) => string | null;
  /** Submit-time check for a new entry's date: the window, then the closed months. */
  check: (date: string, accountIds?: AccountIds, opts?: { postDated?: boolean; label?: string }) => DateCheck;
  /** True when a stored entry sits in a month closed for any of its accounts. */
  isLocked: (date: string | null | undefined, accountIds?: AccountIds) => boolean;
  /** Submit-time check for editing, deleting or cancelling an entry that exists. */
  checkChange: (args: {
    originalDate: string | null | undefined;
    nextDate?: string | null;
    action: 'edit' | 'delete' | 'cancel';
    originalAccountIds?: AccountIds;
    nextAccountIds?: AccountIds;
    kind?: BBEntryKind;
  }) => DateCheck;
  /** True until both documents have arrived; checks refuse meanwhile. */
  loading: boolean;
  /** True when a document failed to load for a reason other than a rules refusal; checks refuse. */
  unavailable: boolean;
}

/**
 * Bank Balance's Date Control window and Month Closure calendar for one kind of entry, from
 * `bankBalanceSettings/dateControl` and `bankBalanceSettings/monthClosure`, live.
 *
 * The same for every user: neither consults a role. Fails closed (bar a rules refusal, above):
 * the defaults say "unrestricted", so answering before the real settings arrive would wave through
 * exactly the entries these rules exist to stop.
 *
 * `nameOf` words a refusal with the account's name rather than its id.
 */
export function useEntryControls(kind: BBEntryKind, nameOf: (accountId: string) => string = (id) => id): EntryControls {
  const [settings, setSettings] = useState<BBDateControlSettings>(() => resolveBBDateControl(null));
  // The closure as stored, resolved for the current day below and again at each check, so a page
  // left open overnight locks a month on its trigger day without anything being written.
  const [closureRaw, setClosureRaw] = useState<Partial<SASMonthClosureSettings> | null>(null);
  const [windowState, setWindowState] = useState<RuleState>('loading');
  const [closureState, setClosureState] = useState<RuleState>('loading');

  // `today` for the picker's bounds, re-read every minute so a form left open past midnight moves
  // with the calendar. The submit checks read the clock at the moment of the check.
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const id = setInterval(() => {
      const now = todayLocal();
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.dateControl),
        (snapshot) => {
          setSettings(resolveBBDateControl(snapshot.data() as Partial<BBDateControlSettings> | undefined));
          setWindowState('ready');
        },
        (error) => {
          if (isRefusal(error)) {
            console.warn('Bank Balance Date Control is not readable for this user yet; no window applied.', error);
            setWindowState('ready');
          } else setWindowState('error');
        },
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.monthClosure),
        (snapshot) => {
          setClosureRaw((snapshot.data() as Partial<SASMonthClosureSettings> | undefined) ?? null);
          setClosureState('ready');
        },
        (error) => {
          if (isRefusal(error)) {
            console.warn('Bank Balance Month Closure is not readable for this user yet; no months treated as closed.', error);
            setClosureState('ready');
          } else setClosureState('error');
        },
      ),
    [],
  );

  const loading = windowState === 'loading' || closureState === 'loading';
  const unavailable = windowState === 'error' || closureState === 'error';
  const closure = useMemo(() => resolveMonthClosure(closureRaw, today), [closureRaw, today]);

  const unresolved = (): DateCheck | null => (unavailable ? RULES_UNAVAILABLE : loading ? RULES_LOADING : null);

  const windowFor: EntryControls['windowFor'] = (accountIds = [], opts = {}) =>
    bbDateWindowForAccounts({ settings, kind, accountIds, postDated: opts.postDated, today });

  const hintFor: EntryControls['hintFor'] = (accountIds = [], opts = {}) => {
    const windowHint = describeBBDateWindow(windowFor(accountIds, opts), today);
    const ids = accountIds.filter((id): id is string => Boolean(id));
    const frozen = new Set((ids.length ? ids : [undefined]).flatMap((id) => closedPeriods(closure, id)));
    if (frozen.size === 0) return windowHint;
    const list = [...frozen].sort();
    const closedHint = list.length === 1 ? `${periodLabel(list[0])} is closed` : `${list.length} months are closed`;
    return windowHint ? `${windowHint} · ${closedHint}` : closedHint;
  };

  return {
    settings,
    windowFor,
    hintFor,
    check: (date, accountIds = [], opts = {}) => {
      const pending = unresolved();
      if (pending) return pending;
      const now = todayLocal();
      const label = opts.label ?? BB_DATE_LABEL[kind];
      const windowCheck = validateBBEntryDate({ date, settings, kind, accountIds, nameOf, label, postDated: opts.postDated, today: now });
      if (!windowCheck.ok) return windowCheck;
      return validateBBEntryAgainstClosure({ date, settings: resolveMonthClosure(closureRaw, now), kind, accountIds, nameOf, label });
    },
    isLocked: (date, accountIds = []) => isEntryLocked({ date, settings: closure, accountIds }),
    checkChange: ({ originalDate, nextDate, action, originalAccountIds, nextAccountIds, kind: entryKind }) => {
      const pending = unresolved();
      if (pending) return pending;
      return validateBBEntryChange({
        originalDate,
        nextDate,
        settings: resolveMonthClosure(closureRaw, todayLocal()),
        kind: entryKind ?? kind,
        action,
        originalAccountIds,
        nextAccountIds,
        nameOf,
      });
    },
    loading,
    unavailable,
  };
}
