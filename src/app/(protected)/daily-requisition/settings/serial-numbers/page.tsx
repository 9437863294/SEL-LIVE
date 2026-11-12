'use client';

/**
 * Daily Requisition › Settings › Serial Numbers: how Reception Nos are made.
 *
 * The number's parts — prefix, financial year (fixed text, or automatic so it rolls over on
 * 1 April), the running number and a suffix — joined by one separator; how many digits the running
 * number has and whether it starts again each financial year; and the next number. A hero shows
 * the next number as it will be issued, and the column on the right what has been issued: the
 * latest numbers, how far the current series has got, and who changed the series when.
 *
 * Saving refuses a next number already issued, so it can never hand out a duplicate. Stored in
 * `serialNumberConfigs/daily-requisition`; the parts are src/lib/daily-requisition-serial.ts and the
 * allocator every entry path uses is src/lib/daily-requisition-import.ts.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, Check, Copy, Hash, ListOrdered, Loader2, ShieldAlert, Type, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { InfoTip } from '@/components/shared/info-tip';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
import { Segmented } from '@/components/daily-requisition/workflow-editor-parts';
import { LEGACY_SERIAL_RESOURCE } from '@/components/settings/serial-number-page';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { counterStart, fyLabel, fyStartOf, type FyToken, type RequisitionSerialConfig } from '@/lib/daily-requisition-import';
import {
  configFromDesign,
  designFromConfig,
  numberFor,
  previewParts,
  runningNumberOf,
  seriesStem,
  staleFixedYear,
  type SerialDesign,
  type SerialPartKind,
  type Separator,
} from '@/lib/daily-requisition-serial';
import { requireDocumentSeries } from '@/lib/document-numbers';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';

const SERIES = requireDocumentSeries('daily-requisition');
const seriesDoc = () => doc(db, 'serialNumberConfigs', SERIES.id);

const PART_LOOK: Record<SerialPartKind, { colour: string; label: string }> = {
  prefix: { colour: '#a7f3d0', label: 'Prefix' },
  fy: { colour: '#c7d2fe', label: 'Financial year' },
  number: { colour: '#fbcfe8', label: 'Running no.' },
  suffix: { colour: '#bae6fd', label: 'Suffix' },
};

interface Issued {
  receptionNo: string;
  at: Date | null;
}

interface HistoryRow {
  id: string;
  who: string;
  at: Date | null;
  what: string;
}

const asDate = (value: unknown): Date | null => {
  const v = value as { toDate?: () => Date; seconds?: number } | null | undefined;
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
};

/** One flat row per setting, for the audit log's from/to. */
const flatten = (c: RequisitionSerialConfig | null) =>
  c
    ? {
        prefix: c.prefix ?? '',
        format: c.format ?? '',
        suffix: c.suffix ?? '',
        startingIndex: c.startingIndex ?? '',
        digits: c.digits ?? 4,
        resetEvery: c.resetEvery ?? 'never',
      }
    : {};

/** What a logged change did, in a line, for the history. */
function describeChange(details: Record<string, unknown>): string {
  const changes = (details.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
  const first = Object.entries(changes)[0];
  if (first) {
    const [field, { from, to }] = first;
    const label: Record<string, string> = {
      startingIndex: 'Next number',
      prefix: 'Prefix',
      format: 'Year part',
      suffix: 'Suffix',
      digits: 'Digits',
      resetEvery: 'Restart',
    };
    const more = Object.keys(changes).length - 1;
    return `${label[field] ?? field} ${from === '' || from === undefined || from === null ? 'set to' : `${String(from)} →`} ${String(to)}${more > 0 ? ` (+${more} more)` : ''}`;
  }
  const next = (details.newConfig as { startingIndex?: unknown } | undefined)?.startingIndex;
  return next !== undefined ? `Series saved · next ${String(next)}` : 'Series saved';
}

const inputClass =
  'w-full rounded-[11px] border bg-card px-2.5 py-2 text-sm outline-none focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/10 disabled:opacity-60';

function PartRow({
  kind,
  title,
  hint,
  on,
  onToggle,
  locked,
  disabled,
  children,
}: {
  kind: SerialPartKind;
  title: string;
  hint: string;
  on: boolean;
  onToggle?: (on: boolean) => void;
  locked?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-3 rounded-[14px] border border-l-4 bg-card px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto]',
        !on && 'opacity-55',
      )}
      style={{ borderLeftColor: on ? PART_LOOK[kind].colour : '#e2e8f0' }}
    >
      <div className="flex items-center gap-1.5">
        <b className="block text-[13px]">{title}</b>
        <InfoTip label={`About “${title}”`}>{hint}</InfoTip>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {locked ? (
        <span className="justify-self-start rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-bold text-muted-foreground sm:justify-self-end">Always on</span>
      ) : (
        <Switch className="justify-self-start sm:justify-self-end" checked={on} onCheckedChange={onToggle} disabled={disabled} aria-label={`${title} on`} />
      )}
    </div>
  );
}

export default function DailyRequisitionSerialNumbersPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const canEdit = can('Edit Serial Nos', 'Daily Requisition.Settings') || can('Edit', LEGACY_SERIAL_RESOURCE);
  // Settings viewers see the series read-only, as they see Printing Setup.
  const canView = canEdit || can('View', 'Daily Requisition.Settings') || can('View', LEGACY_SERIAL_RESOURCE);

  const [today] = useState(() => new Date());
  /** `undefined` while loading; `null` for a series never saved. */
  const [saved, setSaved] = useState<RequisitionSerialConfig | null | undefined>(undefined);
  const [design, setDesign] = useState<SerialDesign | null>(null);
  const [nextTouched, setNextTouched] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [recent, setRecent] = useState<Issued[] | null>(null);
  const [series, setSeries] = useState<{ count: number | null; last: number | null; nextTaken: boolean } | null>(null);
  const [registerDenied, setRegisterDenied] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  // The series.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    let live = true;
    getDoc(seriesDoc())
      .then((snap) => {
        if (!live) return;
        const stored = snap.exists() ? (snap.data() as RequisitionSerialConfig) : null;
        setSaved(stored);
        setDesign(designFromConfig(stored ?? SERIES.suggested, today));
      })
      .catch((error) => {
        console.error('Error fetching serial number config:', error);
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [isAuthLoading, canView, today]);

  // The latest Reception Nos, whatever series they belong to, and who changed the series when.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    let live = true;
    getDocs(query(collection(db, 'dailyRequisitions'), orderBy('createdAt', 'desc'), limit(5)))
      .then((snap) => live && setRecent(snap.docs.map((d) => ({ receptionNo: String(d.data().receptionNo ?? ''), at: asDate(d.data().createdAt) }))))
      .catch(() => {
        if (!live) return;
        setRegisterDenied(true);
        setRecent([]);
      });
    getDocs(query(collection(db, 'userLogs'), where('module', '==', ACTIVITY_MODULES.DAILY_REQUISITION), orderBy('timestamp', 'desc'), limit(150)))
      .then((snap) => {
        if (!live) return;
        setHistory(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
            .filter((row) => row.action === 'Update Serial No. Config')
            .slice(0, 4)
            .map((row) => ({ id: row.id, who: String(row.userName || row.userEmail || 'Someone'), at: asDate(row.timestamp), what: describeChange(row.details ?? {}) })),
        );
      })
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [isAuthLoading, canView]);

  // How far the series as set has got: is the next number free, and what was issued last. Re-asked
  // as the parts change (a moment after typing stops).
  const stem = design ? seriesStem(design, today) : '';
  const nextNo = design ? numberFor(design, design.next, today) : '';
  useEffect(() => {
    if (!design || registerDenied || isAuthLoading || !canView) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const inSeries = stem ? [where('receptionNo', '>=', stem), where('receptionNo', '<', `${stem}`)] : [];
        const [taken, latest, count] = await Promise.all([
          getDocs(query(collection(db, 'dailyRequisitions'), where('receptionNo', '==', nextNo), limit(1))),
          stem ? getDocs(query(collection(db, 'dailyRequisitions'), ...inSeries, orderBy('receptionNo', 'desc'), limit(25))) : Promise.resolve(null),
          stem ? getCountFromServer(query(collection(db, 'dailyRequisitions'), ...inSeries)).catch(() => null) : Promise.resolve(null),
        ]);
        if (!live) return;
        const numbers = (latest?.docs ?? [])
          .map((d) => runningNumberOf(String(d.data().receptionNo ?? ''), design, today))
          .filter((n): n is number => n !== null);
        setSeries({ count: count ? count.data().count : null, last: numbers.length ? Math.max(...numbers) : null, nextTaken: !taken.empty });
      } catch (error) {
        console.error('Could not check the series:', error);
        if (live) setRegisterDenied(true);
      }
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `design` is read for the parse; the query is keyed by what it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stem, nextNo, registerDenied, isAuthLoading, canView]);

  const baseline = useMemo(() => designFromConfig(saved ?? SERIES.suggested, today), [saved, today]);
  const dirty = Boolean(design) && (!saved || JSON.stringify(design) !== JSON.stringify(baseline));
  const disabled = !canEdit;
  const change = (patch: Partial<SerialDesign>) => setDesign((current) => (current ? { ...current, ...patch } : current));

  const duplicate = Boolean(design && series && (series.nextTaken || (series.last !== null && design.next <= series.last)));
  const skipped = design && series && series.last !== null && design.next > series.last + 1 ? design.next - series.last - 1 : 0;
  const stale = design ? staleFixedYear(design, today) : null;

  const save = async () => {
    if (!canEdit || !design || !user || duplicate) return;
    setSaving(true);
    try {
      const config = await runTransaction(db, async (tx) => {
        const snap = await tx.get(seriesDoc());
        const draft = configFromDesign(design, today);
        // Numbers issued while this page was open moved the counter on. Unless the next number was
        // set here on purpose, keep the counter where it now stands rather than wind it back.
        const liveNext = snap.exists() ? counterStart(snap.data() as RequisitionSerialConfig, today) : null;
        const next = !nextTouched && liveNext !== null && liveNext > draft.startingIndex ? { ...draft, startingIndex: liveNext } : draft;
        tx.set(seriesDoc(), next);
        return next;
      });
      const changes = diffFields(flatten(saved ?? null), flatten(config));
      void log(
        'Update Serial No. Config',
        { configuredModule: SERIES.id, newConfig: config, changes },
        { recordId: SERIES.id, recordRef: SERIES.id },
      );
      setSaved(config);
      setDesign(designFromConfig(config, today));
      setNextTouched(false);
      setHistory((rows) => [{ id: `local-${Date.now()}`, who: user.name || 'You', at: new Date(), what: describeChange({ changes, newConfig: config }) }, ...(rows ?? [])].slice(0, 4));
      toast({ title: 'Series saved', description: `The next requisition is numbered ${numberFor(designFromConfig(config, today), config.startingIndex, today)}.` });
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast({ title: 'Not saved', description: 'Check your connection and try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- render ---------------- */
  if (isAuthLoading || (canView && saved === undefined && !loadFailed)) {
    return (
      <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1400px]')}>
        <Skeleton className="mb-4 h-5 w-64" />
        <Skeleton className="mb-4 h-56 w-full rounded-[24px]" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 rounded-[20px]" />
          <Skeleton className="h-72 rounded-[20px]" />
        </div>
      </div>
    );
  }

  if (!canView || loadFailed || !design) {
    return (
      <div className={cn(dailyPageContainerClass, 'mx-auto max-w-5xl')}>
        <PageHeader eyebrow="Daily Requisition" title="Serial Numbers" icon={Hash} backHref="/daily-requisition/settings" />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>{loadFailed ? 'Could not load the series' : 'Access Denied'}</CardTitle>
            <CardDescription>{loadFailed ? 'Check your connection and reload the page.' : 'You do not have permission to view this page.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const parts = previewParts(design, design.next, today);
  const lastIssuedNo = series?.last !== null && series?.last !== undefined ? numberFor(design, series.last, today) : null;
  const nextFyStart = fyStartOf(today) + 1;
  // Gaps among the latest numbers of this series: each should be one more than the one after it.
  const recentInSeries = (recent ?? []).map((r) => runningNumberOf(r.receptionNo, design, today)).filter((n): n is number => n !== null);
  const gapFree = recentInSeries.every((n, i) => i === 0 || recentInSeries[i - 1] - n === 1);

  return (
    <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1400px] pb-28')}>
      <style>{`
        @keyframes dr-serial-drift { to { background-position: 100% 50%; } }
        .dr-serial-hero { background-size: 140% 140%; animation: dr-serial-drift 18s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .dr-serial-hero { animation: none; } }
      `}</style>

      {/* Where this is */}
      <nav className="mb-3.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/daily-requisition/settings" className="mr-1 grid h-[30px] w-[30px] place-items-center rounded-[9px] border bg-card text-foreground/70 hover:text-foreground" aria-label="Back to settings">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/daily-requisition" className="text-foreground/70 hover:underline">
          Daily Requisition
        </Link>
        <span aria-hidden>›</span>
        <Link href="/daily-requisition/settings" className="text-foreground/70 hover:underline">
          Settings
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Serial Numbers</span>
      </nav>

      {/* The next number, as it will be issued */}
      <section
        className="dr-serial-hero relative overflow-hidden rounded-[24px] p-5 text-white sm:p-7"
        style={{
          backgroundImage:
            'radial-gradient(520px 260px at 95% 0%, #f59e0bb0, transparent 65%), radial-gradient(560px 300px at 70% 120%, #db2777c0, transparent 65%), radial-gradient(600px 340px at 0% 100%, #0f766ef2, transparent 70%), linear-gradient(115deg, #0f766e, #0284c7 35%, #4f46e5 65%, #7c3aed)',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(#ffffff14 1px, transparent 1px)',
            backgroundSize: '18px 18px',
            maskImage: 'linear-gradient(90deg, transparent, #000 70%)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 70%)',
          }}
        />
        <div className="relative flex flex-wrap items-center gap-3.5">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-[16px] bg-white/15 shadow-[inset_0_1px_0_#ffffff40]">
            <Hash className="h-6 w-6" />
          </span>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Daily Requisition · Settings</div>
            <h1 className="text-2xl font-extrabold tracking-tight">Serial Numbers</h1>
          </div>
          <span className="flex-1" />
          <span className="rounded-[11px] border border-white/25 bg-white/10 px-3 py-2 text-[13px] font-bold">Reception No. · Daily Requisition</span>
          {!canEdit && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11.5px] font-bold">Read-only</span>}
        </div>
        <div className="relative mt-5 flex flex-wrap items-end gap-4 pb-6">
          <div className="min-w-0">
            <small className="mb-1.5 block text-[11.5px] font-extrabold uppercase tracking-[0.09em] text-emerald-200">
              {saved ? 'The next requisition will be numbered' : 'Not saved yet — the next requisition would be numbered'}
            </small>
            <div className="flex flex-wrap font-mono text-[28px] font-bold leading-none sm:text-[40px]" aria-label={nextNo}>
              {parts.map((part, i) => (
                <span key={`${part.kind}-${i}`} className="flex">
                  <span className="group relative rounded-[9px] px-1.5 py-1 transition hover:bg-white/10">
                    {part.text}
                    <span
                      className="absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-px font-sans text-[10px] font-bold uppercase tracking-wide text-slate-900"
                      style={{ background: PART_LOOK[part.kind].colour }}
                    >
                      {PART_LOOK[part.kind].label}
                    </span>
                  </span>
                  {i < parts.length - 1 && design.separator ? <span className="py-1 opacity-50">{design.separator}</span> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-white/20 bg-white/10 px-3.5 py-2.5 backdrop-blur sm:ml-auto">
            <small className="text-[11.5px] font-extrabold uppercase tracking-[0.09em] text-emerald-200">Then</small>
            <div className="font-mono text-[12.5px] text-sky-100">
              {numberFor(design, design.next + 1, today)}
              <br />
              {numberFor(design, design.next + 2, today)}
            </div>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1.5 self-start rounded-[10px] border border-white/25 bg-white/10 px-2.5 py-1.5 text-[13px] font-bold hover:bg-white/20"
              onClick={() => {
                void navigator.clipboard?.writeText(nextNo);
                toast({ title: 'Copied', description: nextNo });
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
        </div>
      </section>

      {/* A fixed year that has fallen behind */}
      {stale && (
        <div className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-950">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-amber-200 text-amber-800">
            <AlertTriangle className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <b>The year in the number is still {stale.stored}, but the financial year is now {stale.current}.</b> New Reception Nos carry last
            year&apos;s tag. Make the year part automatic so it rolls over by itself each 1 April.
          </div>
          {canEdit && (
            <Button variant="outline" className="ml-auto border-amber-300 bg-card" onClick={() => change({ fyMode: 'auto', fyToken: stale.token })}>
              Use automatic FY
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3.5">
          {/* Number format */}
          <section className="rounded-[20px] border bg-card">
            <header className="flex items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] text-white" style={{ background: 'linear-gradient(145deg, #c4b5fd, #6d28d9)' }}>
                <Type className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1.5">
                <b className="block text-[14.5px] leading-tight">Number format</b>
                <InfoTip label="About “Number format”">The parts that make up the number, in order. Turn parts on or off.</InfoTip>
              </div>
            </header>
            <div className="space-y-2 px-4 py-4 sm:px-[18px]">
              <PartRow kind="prefix" title="Prefix" hint="Text before everything" on={design.prefixOn} onToggle={(on) => change({ prefixOn: on })} disabled={disabled}>
                <input
                  aria-label="Prefix"
                  className={cn(inputClass, 'max-w-[220px] font-mono font-semibold')}
                  value={design.prefix}
                  disabled={disabled || !design.prefixOn}
                  placeholder="e.g. SEL/REC"
                  onChange={(e) => change({ prefix: e.target.value })}
                />
              </PartRow>
              <PartRow kind="fy" title="Financial year" hint="Which year the number belongs to" on={design.fyOn} onToggle={(on) => change({ fyOn: on })} disabled={disabled}>
                <Segmented
                  value={design.fyMode}
                  disabled={disabled || !design.fyOn}
                  onChange={(fyMode) => change({ fyMode })}
                  options={[
                    { value: 'auto', label: 'Automatic' },
                    { value: 'fixed', label: 'Fixed text' },
                  ]}
                />
                {design.fyMode === 'auto' ? (
                  <select
                    aria-label="How the year reads"
                    className={cn(inputClass, 'w-auto font-mono')}
                    value={design.fyToken}
                    disabled={disabled || !design.fyOn}
                    onChange={(e) => change({ fyToken: e.target.value as FyToken })}
                  >
                    {(['{FY}', '{FY2}', '{FYS}'] as FyToken[]).map((token) => (
                      <option key={token} value={token}>
                        {fyLabel(fyStartOf(today), token)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="Year text"
                    className={cn(inputClass, 'max-w-[130px] font-mono font-semibold')}
                    value={design.fyText}
                    disabled={disabled || !design.fyOn}
                    placeholder="2026-27"
                    onChange={(e) => change({ fyText: e.target.value })}
                  />
                )}
              </PartRow>
              <PartRow kind="number" title="Running number" hint="Goes up by one each time" on locked>
                <span className="rounded-lg bg-muted px-2.5 py-1 font-mono font-bold">{String(design.next).padStart(design.digits, '0')}</span>
              </PartRow>
              <PartRow kind="suffix" title="Suffix" hint="Text after the running number" on={design.suffixOn} onToggle={(on) => change({ suffixOn: on })} disabled={disabled}>
                <input
                  aria-label="Suffix"
                  className={cn(inputClass, 'max-w-[200px] font-mono font-semibold')}
                  value={design.suffix}
                  disabled={disabled || !design.suffixOn}
                  placeholder="e.g. A"
                  onChange={(e) => change({ suffix: e.target.value })}
                />
              </PartRow>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-[11.5px] font-bold text-slate-600">Separator between parts</span>
                <InfoTip label="About “Separator between parts”">Added for you, so you don&apos;t type it into each part.</InfoTip>
                <Segmented<Separator>
                  value={design.separator}
                  disabled={disabled}
                  onChange={(separator) => change({ separator })}
                  options={[
                    { value: '/', label: '/' },
                    { value: '\\', label: '\\' },
                    { value: '-', label: '-' },
                    { value: '.', label: '.' },
                    { value: '', label: 'none' },
                  ]}
                />
              </div>
            </div>
          </section>

          {/* Running number */}
          <section className="rounded-[20px] border bg-card">
            <header className="flex items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] text-white" style={{ background: 'linear-gradient(145deg, #7dd3fc, #0369a1)' }}>
                <ListOrdered className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1.5">
                <b className="block text-[14.5px] leading-tight">Running number</b>
                <InfoTip label="About “Running number”">The counter that goes up by one with every requisition</InfoTip>
              </div>
            </header>
            <div className="px-4 py-4 sm:px-[18px]">
              <div className="grid gap-3.5 lg:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-bold text-slate-600" htmlFor="next-no">
                    Next running number
                  </label>
                  <div className="flex items-center overflow-hidden rounded-[11px] border">
                    <button
                      type="button"
                      className="h-[38px] w-[34px] bg-muted/50 font-extrabold text-muted-foreground disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => {
                        setNextTouched(true);
                        change({ next: Math.max(1, design.next - 1) });
                      }}
                    >
                      −
                    </button>
                    <input
                      id="next-no"
                      inputMode="numeric"
                      className="h-[38px] w-full min-w-0 bg-transparent text-center font-mono text-[15px] font-bold outline-none"
                      value={design.next}
                      disabled={disabled}
                      onChange={(e) => {
                        setNextTouched(true);
                        change({ next: Math.max(1, parseInt(e.target.value.replace(/\D/g, '') || '1', 10)) });
                      }}
                    />
                    <button
                      type="button"
                      className="h-[38px] w-[34px] bg-muted/50 font-extrabold text-muted-foreground disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => {
                        setNextTouched(true);
                        change({ next: design.next + 1 });
                      }}
                    >
                      +
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                    {registerDenied ? 'Issued numbers could not be checked.' : series === null ? 'Checking issued numbers…' : lastIssuedNo ? `Last issued: ${lastIssuedNo}` : 'Nothing issued in this series yet.'}
                  </p>
                </div>
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-bold text-slate-600">Digits (zero-padded)</span>
                  <Segmented
                    value={String(design.digits) as '3' | '4' | '5' | '6'}
                    disabled={disabled}
                    onChange={(v) => change({ digits: Number(v) })}
                    options={(['3', '4', '5', '6'] as const).map((d) => ({ value: d, label: `${d} · ${String(64).padStart(Number(d), '0')}` }))}
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-bold text-slate-600">Start again from 1</span>
                  <Segmented
                    value={design.resetEvery}
                    disabled={disabled}
                    onChange={(resetEvery) => change(resetEvery === 'fy' ? { resetEvery, fyOn: true, fyMode: 'auto' } : { resetEvery })}
                    options={[
                      { value: 'never', label: 'Never' },
                      { value: 'fy', label: 'Each FY (1 Apr)' },
                    ]}
                  />
                </div>
              </div>

              {duplicate && series && (
                <p className="mt-3 flex items-start gap-2 rounded-[11px] bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {nextNo} has already been issued. Saving this would create duplicate Reception Nos.
                    {series.last !== null ? ` The lowest safe value is ${series.last + 1}.` : ''}
                  </span>
                </p>
              )}
              {!duplicate && skipped > 0 && series?.last !== null && series && (
                <p className="mt-3 flex items-start gap-2 rounded-[11px] bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This skips {skipped} number{skipped === 1 ? '' : 's'} ({(series.last ?? 0) + 1}
                    {skipped > 1 ? `–${design.next - 1}` : ''}). Auditors may ask why.
                  </span>
                </p>
              )}
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                {design.resetEvery === 'fy' ? (
                  <>
                    On <b>1 April {nextFyStart}</b> the counter returns to 1, and the year becomes {fyLabel(nextFyStart, design.fyToken)}.
                  </>
                ) : (
                  'The counter keeps counting across years. To start again at 1 each April, choose "Each FY" — it needs the automatic year in the number, so numbers never repeat.'
                )}
              </p>
            </div>
          </section>
        </div>

        {/* What has been issued */}
        <aside className="flex flex-col gap-3.5 xl:sticky xl:top-4">
          <section className="rounded-[20px] border bg-card">
            <header className="flex items-center gap-2 border-b px-[18px] py-3.5">
              <div className="flex items-center gap-1.5">
                <b className="block text-[14.5px] leading-tight">Recently issued</b>
                <InfoTip label="About “Recently issued”">The latest Reception Nos</InfoTip>
              </div>
              <span className="flex-1" />
              {recentInSeries.length > 1 && (
                <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', gapFree ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')}>
                  {gapFree ? 'No gaps' : 'Gap in sequence'}
                </span>
              )}
            </header>
            <div className="px-[18px] pb-3.5 pt-1">
              {recent === null ? (
                <Skeleton className="mt-2 h-24 w-full" />
              ) : registerDenied ? (
                <p className="py-2 text-xs text-muted-foreground">You cannot see the register, so issued numbers are not shown.</p>
              ) : recent.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No requisitions yet.</p>
              ) : (
                recent.map((row) => (
                  <div key={row.receptionNo + String(row.at)} className="flex items-center gap-2.5 border-b border-dashed py-2 text-[12.5px] last:border-b-0">
                    <span className="truncate font-mono font-bold">{row.receptionNo || '—'}</span>
                    <small className="ml-auto shrink-0 text-muted-foreground">{row.at ? format(row.at, 'd MMM, HH:mm') : ''}</small>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[20px] border bg-card">
            <header className="border-b px-[18px] py-3.5">
              <b className="block text-[14.5px] leading-tight">This series</b>
              <p className="truncate font-mono text-xs text-muted-foreground" title={stem}>
                {stem || '(no prefix)'}…
              </p>
            </header>
            <div className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1.5 px-[18px] py-3.5 text-[12.5px]">
              <span className="text-muted-foreground">Numbers issued</span>
              <b className="font-mono">{registerDenied ? '—' : series?.count?.toLocaleString('en-IN') ?? '…'}</b>
              <span className="text-muted-foreground">Last running number</span>
              <b className="font-mono">{registerDenied ? '—' : series === null ? '…' : series.last !== null ? String(series.last).padStart(design.digits, '0') : 'none yet'}</b>
              <span className="text-muted-foreground">Next</span>
              <b className="font-mono">{String(design.next).padStart(design.digits, '0')}</b>
            </div>
          </section>

          <section className="rounded-[20px] border bg-card">
            <header className="border-b px-[18px] py-3.5">
              <b className="block text-[14.5px] leading-tight">Change history</b>
            </header>
            <div className="px-[18px] py-3.5">
              {history === null ? (
                <Skeleton className="h-16 w-full" />
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No changes recorded.</p>
              ) : (
                <ol className="ml-1.5 border-l-2 pl-3.5">
                  {history.map((row, i) => (
                    <li key={row.id} className="relative mb-2.5 text-[12.5px] last:mb-0">
                      <span className={cn('absolute -left-[21px] top-[5px] h-2.5 w-2.5 rounded-full border-2 border-violet-600', i === 0 ? 'bg-violet-600' : 'bg-card')} />
                      {row.what}
                      <small className="block text-muted-foreground">
                        {row.who}
                        {row.at ? ` · ${format(row.at, 'd MMM yyyy')}` : ''}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
              <Link href="/daily-requisition/audit-log" className="mt-2 inline-block text-xs font-semibold text-violet-700 hover:underline">
                Full audit log →
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {/* Unsaved changes */}
      <div
        className={cn(
          'fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-[0_20px_50px_-10px_rgba(15,23,42,0.53)] transition-all duration-200',
          dirty && canEdit ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[150%] opacity-0',
        )}
        role="status"
      >
        <span>
          {saved ? 'Changes apply to the next requisition' : 'Not saved yet — requisitions cannot be numbered until the series is saved'}
          {duplicate ? <span className="block text-xs text-rose-300">Fix the duplicate number first.</span> : null}
        </span>
        {saved && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={saving}
            onClick={() => {
              setDesign(baseline);
              setNextTouched(false);
            }}
          >
            Discard
          </Button>
        )}
        <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => void save()} disabled={saving || duplicate}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          {saved ? 'Save' : 'Save and start numbering'}
        </Button>
      </div>
    </div>
  );
}
