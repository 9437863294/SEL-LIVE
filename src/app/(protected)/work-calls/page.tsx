'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { auth } from '@/lib/firebase';
import type { WorkContact, WorkContactType } from '@/lib/work-calls-model';
import {
  ActiveCallCard,
  DirectoryCard,
  PurposeDialog,
  TodayCard,
  WorkCallsFrame,
  type ActiveCall,
  type CallState,
  type RecentCall,
} from './render';

/**
 * Work Calls (§Q–§U).
 *
 * ── Why this is a web page and not a native screen ─────────────────────────────────────────────
 *
 * The SEL LIVE Android application is this web app in a Capacitor shell, so a route here *is* a
 * screen in the app — no plugin, no release, no store review. Dialling is a `tel:` link, which
 * needs no permission and behaves the same on every Android version.
 *
 * ── The confirmation step, and why it is not an annoyance ──────────────────────────────────────
 *
 * Nothing in the web layer is told when a call connects or ends; that needs restricted
 * permissions Android no longer gives ordinary apps. So the app records the dial, and when it
 * becomes visible again it asks. The alternative — treating "away for nineteen minutes" as a
 * nineteen-minute call — would be a guess presented as a measurement, and it would be wrong
 * every time somebody left a voicemail and went to lunch.
 *
 * An unconfirmed dial is worth no time at all. That is deliberate: it keeps the timeline honest
 * and it makes confirming worth doing.
 *
 * ── Why the markup is next door ────────────────────────────────────────────────────────────────
 *
 * This file is the behaviour; `render.tsx` is the appearance, built from the same components the
 * rest of the module uses. They were one file, and the middle third was hand-rolled Tailwind —
 * a bespoke bottom sheet, a hand-drawn list, a header that was not `HrPageHeader` — which looked
 * like a different application to everything either side of it.
 */

async function authorizedFetch(path: string, init?: RequestInit) {
  // Taken fresh rather than cached, the same way the rest of the module does it: a stale token
  // would fail a call that looked fine. Missing is reported here rather than as a server 401,
  // because "your sign-in expired" is actionable and "401" is not.
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Your sign-in has expired. Reload the page and try again.');

  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

export default function WorkCallsPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<WorkContactType | 'ALL'>('ALL');
  const [contacts, setContacts] = useState<WorkContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<WorkContact | null>(null);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);

  const [active, setActive] = useState<ActiveCall | null>(null);
  const [recent, setRecent] = useState<RecentCall[]>([]);

  /* ── Today, including anything left unconfirmed ────────────────────────────────────── */

  const loadToday = useCallback(async () => {
    try {
      const response = await authorizedFetch('/api/work-calls/today');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load today.');

      const calls: RecentCall[] = (body.calls || []).map((call: Record<string, unknown>) => ({
        id: String(call.id),
        contactName: String(call.contactName),
        contactCompany: (call.contactCompany as string) ?? null,
        purpose: (call.purpose as string) ?? null,
        dialledAt: String(call.dialledAt),
        state: call.state as CallState,
        durationSeconds: (call.durationSeconds as number) ?? null,
      }));

      // A call still in DIALLED is one the phone never got to confirm — most likely because
      // Android killed the web view while the dialer was in front. Picking it back up here is
      // the difference between asking a day later and never asking at all.
      const outstanding = calls.filter((call) => call.state === 'DIALLED').pop();
      if (outstanding) setActive(outstanding);

      setRecent(calls.filter((call) => call.state !== 'DIALLED').reverse());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  /* ── Directory ─────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    // Debounced, because this fires on every keystroke and the directory is a shared read.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (type !== 'ALL') params.set('type', type);
        const response = await authorizedFetch('/api/work-calls/contacts?' + params.toString());
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || 'Could not load the directory.');
        setContacts(body.contacts || []);
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, type]);

  /* ── Dial ──────────────────────────────────────────────────────────────────────────── */

  const dial = useCallback(async (contact: WorkContact, callPurpose: string) => {
    setBusy(true);
    try {
      // Recorded *before* following the tel: link. Once the dialer takes over this page may be
      // suspended and never gets another chance to tell the server anything.
      const response = await authorizedFetch('/api/work-calls/start', {
        method: 'POST',
        body: JSON.stringify({
          contactId: contact.id,
          purpose: callPurpose || null,
          deviceInfo: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 120),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not start the call.');

      setActive({
        id: body.call.id,
        contactName: body.call.contactName,
        contactCompany: body.call.contactCompany,
        purpose: body.call.purpose,
        dialledAt: body.call.dialledAt,
      });
      setPending(null);
      setPurpose('');
      setError(null);

      window.location.href = 'tel:' + contact.mobile.replace(/\s+/g, '');
    } catch (dialError) {
      setError(dialError instanceof Error ? dialError.message : String(dialError));
    } finally {
      setBusy(false);
    }
  }, []);

  /* ── Confirm ───────────────────────────────────────────────────────────────────────── */

  const settle = useCallback(async (callId: string, cancelled: boolean) => {
    setBusy(true);
    try {
      const response = await authorizedFetch('/api/work-calls/end', {
        method: 'POST',
        body: JSON.stringify({ callId, cancelled }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save the call.');

      setRecent((previous) => [
        {
          id: body.call.id,
          contactName: body.call.contactName,
          contactCompany: body.call.contactCompany,
          purpose: body.call.purpose,
          dialledAt: body.call.dialledAt,
          state: body.call.state,
          durationSeconds: body.call.durationSeconds,
        },
        ...previous,
      ].slice(0, 20));
      setActive(null);
      setError(null);
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : String(settleError));
    } finally {
      setBusy(false);
    }
  }, []);

  /* ── Coming back from the dialer ───────────────────────────────────────────────────── */

  /**
   * The elapsed figure on the confirm button has to move, in two situations that look the same
   * from here: the page has been visible for a while with a call outstanding, and the page has
   * just come back from the dialer. A tick covers both, and it is the only reason this state
   * exists — nothing reads its value.
   */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);

    // Becoming visible again is the only signal the web layer gets that a call is over. It
    // confirms nothing by itself; it refreshes the figure the employee is about to agree to.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);

  const elapsed = useMemo(() => {
    if (!active) return 0;
    return Math.max(0, Math.round((Date.now() - Date.parse(active.dialledAt)) / 1000));
    // `tick` is the clock; `active` is the call being timed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tick]);

  /* ── Render ────────────────────────────────────────────────────────────────────────── */

  return (
    <WorkCallsFrame error={error}>
      {active ? (
        <ActiveCallCard
          call={active}
          elapsed={elapsed}
          busy={busy}
          onConfirm={() => settle(active.id, false)}
          onCancel={() => settle(active.id, true)}
        />
      ) : null}

      <DirectoryCard
        query={query}
        onQueryChange={setQuery}
        type={type}
        onTypeChange={setType}
        contacts={contacts}
        loading={loading}
        onCall={setPending}
      />

      {recent.length > 0 ? <TodayCard calls={recent} /> : null}

      <PurposeDialog
        contact={pending}
        purpose={purpose}
        busy={busy}
        onPurposeChange={setPurpose}
        onDial={() => pending && dial(pending, purpose)}
        onClose={() => setPending(null)}
      />
    </WorkCallsFrame>
  );
}
