'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, PhoneOff, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { auth } from '@/lib/firebase';
import { WORK_CONTACT_TYPES, type WorkContact, type WorkContactType } from '@/lib/work-calls-model';
import { cn } from '@/lib/utils';

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
 */

type CallState = 'DIALLED' | 'COMPLETED' | 'CANCELLED' | 'NOT_CONFIRMED';

interface ActiveCall {
  id: string;
  contactName: string;
  contactCompany: string | null;
  purpose: string | null;
  dialledAt: string;
}

interface RecentCall extends ActiveCall {
  state: CallState;
  durationSeconds: number | null;
}

const TYPE_LABELS: Record<WorkContactType, string> = {
  CLIENT: 'Client',
  SITE_MANAGER: 'Site manager',
  VENDOR: 'Vendor',
  CONTRACTOR: 'Contractor',
  EMPLOYEE: 'Employee',
  CONSULTANT: 'Consultant',
  BANK: 'Bank',
  GOVERNMENT: 'Government',
  OTHER: 'Other',
};

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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return rest + 's';
  return minutes + 'm' + (rest ? ' ' + rest + 's' : '');
}

export default function WorkCallsPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<WorkContactType | 'ALL'>('ALL');
  const [contacts, setContacts] = useState<WorkContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<WorkContact | null>(null);
  const [purpose, setPurpose] = useState('');

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
    }
  }, []);

  /* ── Confirm ───────────────────────────────────────────────────────────────────────── */

  const settle = useCallback(async (callId: string, cancelled: boolean) => {
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
    <div className="mx-auto w-full max-w-2xl p-4 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Work calls</h1>
        <p className="text-sm text-muted-foreground">
          Call a contact from the company directory and it appears on your work timeline.
        </p>
      </header>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* The call that is in progress, and the question that settles it. */}
      {active ? (
        <div className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Call in progress</p>
          <p className="mt-1 text-base font-semibold text-slate-900">
            {active.contactName}
            {active.contactCompany ? <span className="font-normal text-slate-500"> · {active.contactCompany}</span> : null}
          </p>
          {active.purpose ? <p className="text-sm text-slate-600">{active.purpose}</p> : null}
          <p className="mt-2 text-sm text-slate-600">
            Dialled {new Date(active.dialledAt).toLocaleTimeString()} · about {formatDuration(elapsed)} ago
          </p>

          <p className="mt-3 text-sm text-slate-700">Did the call happen?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => settle(active.id, false)} className="gap-2">
              <Phone className="h-4 w-4" aria-hidden />
              Yes — about {formatDuration(elapsed)}
            </Button>
            <Button variant="outline" onClick={() => settle(active.id, true)} className="gap-2">
              <PhoneOff className="h-4 w-4" aria-hidden />
              No, it didn&apos;t connect
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Unconfirmed calls are not counted as work time, so this is worth answering.
          </p>
        </div>
      ) : null}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, company, or the number itself"
          className="pl-9"
          inputMode="search"
        />
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {(['ALL', ...WORK_CONTACT_TYPES] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value as WorkContactType | 'ALL')}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
              type === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {value === 'ALL' ? 'All' : TYPE_LABELS[value as WorkContactType]}
          </button>
        ))}
      </div>

      {/* Directory */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading the directory…</p>
      ) : contacts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No contacts match</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query.trim()
              ? 'Try a shorter search, or ask an administrator to add them to the directory.'
              : 'The work directory is empty. An administrator can add clients, site managers and vendors.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{contact.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[TYPE_LABELS[contact.contactType], contact.company, contact.designation]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setPending(contact)}>
                <Phone className="h-3.5 w-3.5" aria-hidden />
                Call
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* The day's calls, so somebody can see their own totals without leaving the page. */}
      {recent.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Today
          </h2>
          <ul className="divide-y rounded-xl border">
            {recent.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.contactName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.dialledAt).toLocaleTimeString()}
                    {entry.purpose ? ' · ' + entry.purpose : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    entry.state === 'COMPLETED' ? 'font-medium text-emerald-700' : 'text-muted-foreground',
                  )}
                >
                  {entry.state === 'COMPLETED'
                    ? formatDuration(entry.durationSeconds)
                    : entry.state === 'CANCELLED'
                      ? 'Not connected'
                      : 'Not counted'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Purpose, asked before dialling because nobody will type it afterwards. */}
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center">
          <div className="w-full rounded-t-2xl bg-background p-4 sm:max-w-sm sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{pending.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[pending.company, pending.mobile].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button type="button" onClick={() => setPending(null)} aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <label className="text-xs font-medium text-muted-foreground" htmlFor="call-purpose">
              What is the call about? (optional)
            </label>
            <Input
              id="call-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Material approval, site progress…"
              className="mt-1"
            />

            <Button className="mt-4 w-full gap-2" onClick={() => dial(pending, purpose)}>
              <Phone className="h-4 w-4" aria-hidden />
              Call {pending.name}
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Come back here afterwards to confirm how long it took.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
