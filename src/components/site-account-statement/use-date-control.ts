'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  SAS_COLLECTIONS,
  SAS_DATE_CONTROL_DOC_ID,
} from '@/lib/site-account-statement';
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

  const canBypass =
    can('Add', `${MODULE}.Backdated Entry`) ||
    can('Edit', `${MODULE}.Backdated Entry`) ||
    can('View', `${MODULE}.All Projects`);

  const window = useMemo(
    () => resolveDateWindow({ settings, kind, canBypass, today }),
    [settings, kind, canBypass, today],
  );

  const hint = useMemo(() => describeDateWindow(window, settings), [window, settings]);

  function check(date: string): DateCheck {
    return validateEntryDate({ date, settings, kind, canBypass, today });
  }

  return { settings, window, canBypass, hint, check, loading };
}
