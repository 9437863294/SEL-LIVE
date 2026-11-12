'use client';

/**
 * Data Control — the rules the Entry Sheet and its import enforce: the reception-date window, when
 * entries may still be edited or deleted at each stage, entry rules, and the register / import
 * defaults. Saved to `dailyRequisitionSettings/module-config`, read live through
 * `useDailyRequisitionSettings`.
 *
 * Laid out as sections with a contents list on the left and, on the right, a risk check: every
 * setting that loosens control, why it matters, and a one-click fix. The hero's score sums those up.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, count, getAggregateFromServer, getCountFromServer, getDocs, limit, orderBy, query, sum, where } from 'firebase/firestore';
import { addDays, format } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Database,
  Loader2,
  Lock,
  PencilLine,
  ShieldCheck,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import {
  DAILY_REQUISITION_SETTINGS_PATH,
  DR_BACKDATE_PRESETS,
  DR_DATE_PRESETS,
  MAX_WINDOW_DAYS,
  defaultDataControl,
  flattenDataControl,
  hasBlockingIssue,
  validateDailyRequisitionSettings,
  type DRDataControl,
  type DRDateControl,
  type DRDatePreset,
} from '@/lib/daily-requisition-settings';
import { saveDailyRequisitionSettings, useDailyRequisitionSettings } from '@/components/daily-requisition/use-daily-requisition-settings';
import { IssueList, SettingsAccessDenied, SettingsSkeleton, describeLastUpdate } from '@/components/daily-requisition/settings-controls';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { Avatar } from '@/components/daily-requisition/workflow-editor-parts';
import { InfoTip } from '@/components/shared/info-tip';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';

const TITLE = 'Data Control';
const DESCRIPTION = 'Date window, edit and delete rules, entry checks and register defaults for the Entry Sheet.';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const compactInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr.format(n);

const THRESHOLD_PRESETS: Array<{ amount: number; label: string }> = [
  { amount: 0, label: 'Off' },
  { amount: 50000, label: '₹50 K' },
  { amount: 100000, label: '₹1 L' },
  { amount: 500000, label: '₹5 L' },
];

/** What the import compares to call a row a duplicate (src/lib/daily-requisition-import.ts requisitionFingerprint). */
const DUPLICATE_FIELDS = ['Project', 'Department', 'Gross amount', 'Party', 'Description', 'Date'];

type SectionId = 'window' | 'edit' | 'rules' | 'register';

interface Risk {
  id: string;
  section: SectionId;
  level: 'bad' | 'warn';
  title: string;
  why: string;
  fix: string;
  apply: (data: DRDataControl) => DRDataControl;
}

/** Every setting that loosens control, worst first, each with the change that tightens it. */
function risksOf(d: DRDataControl): Risk[] {
  const risks: Risk[] = [];
  if (!d.dateControl.enabled) {
    risks.push({
      id: 'window',
      section: 'window',
      level: 'bad',
      title: 'Date window is off',
      why: 'Any reception date, years back or in the future, can be entered.',
      fix: 'Turn on · 7 days back',
      apply: (x) => ({ ...x, dateControl: { ...x.dateControl, enabled: true, backdateDays: 7, futureDays: 0 } }),
    });
  }
  if (d.allowDeleteAfterReceived) {
    risks.push({
      id: 'delete',
      section: 'edit',
      level: 'bad',
      title: 'Deleting allowed after received',
      why: 'A received requisition can disappear from the register.',
      fix: 'Block delete after received',
      apply: (x) => ({ ...x, allowDeleteAfterReceived: false, allowDeleteAfterVerified: false }),
    });
  }
  if (d.netMayExceedGross) {
    risks.push({
      id: 'net',
      section: 'rules',
      level: 'warn',
      title: 'Net amount can exceed gross',
      why: "Deductions can't make a bill bigger; it is usually a typing error.",
      fix: 'Block it',
      apply: (x) => ({ ...x, netMayExceedGross: false }),
    });
  }
  if (d.allowEditAfterReceived && d.allowEditAfterVerified) {
    risks.push({
      id: 'edit-verified',
      section: 'edit',
      level: 'warn',
      title: 'Editing allowed after verification',
      why: 'Amounts can change after GST & TDS Verification has checked them.',
      fix: 'Block edit after verified',
      apply: (x) => ({ ...x, allowEditAfterVerified: false }),
    });
  }
  if (!d.highValueThreshold) {
    risks.push({
      id: 'high-value',
      section: 'rules',
      level: 'warn',
      title: 'No high-value flag',
      why: 'Large bills look the same as small ones in the register.',
      fix: 'Flag ₹1 lakh and above',
      apply: (x) => ({ ...x, highValueThreshold: 100000 }),
    });
  }
  if (d.dateControl.enabled && !d.dateControl.applyToImport) {
    risks.push({
      id: 'import-window',
      section: 'window',
      level: 'warn',
      title: 'Imports ignore the date window',
      why: 'A spreadsheet can bring in rows dated anywhere.',
      fix: 'Apply it to imports',
      apply: (x) => ({ ...x, dateControl: { ...x.dateControl, applyToImport: true } }),
    });
  }
  return risks;
}

const scoreOf = (risks: Risk[]) => Math.max(0, 100 - risks.reduce((s, r) => s + (r.level === 'bad' ? 22 : 9), 0));

function Card({ id, icon: Icon, from, to, title, description, aside, children }: { id: string; icon: LucideIcon; from: string; to: string; title: string; description: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mb-3.5 scroll-mt-4 overflow-hidden rounded-[20px] border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3.5">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-white" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <b className="block text-[14.5px] leading-tight">{title}</b>
          <InfoTip label={`About “${title}”`}>{description}</InfoTip>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** `tip` is the setting's explanation, behind an (i); `hint` stays open — for what the current value does. */
function Row({ title, hint, tip, control, risky, children }: { title: string; hint?: ReactNode; tip?: ReactNode; control?: ReactNode; risky?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-start gap-3.5 border-t px-[18px] py-3 first:border-t-0', risky && 'bg-gradient-to-r from-orange-50 to-transparent')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <b className="block text-[13.5px]">{title}</b>
          {tip ? <InfoTip label={`About “${title}”`}>{tip}</InfoTip> : null}
        </div>
        {hint ? <small className="block text-xs text-muted-foreground">{hint}</small> : null}
        {children}
      </div>
      {control ? <div className="flex items-center gap-2.5">{control}</div> : null}
    </div>
  );
}

function Stepper({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className={cn('flex items-center overflow-hidden rounded-[11px] border', disabled && 'opacity-40')}>
      <button type="button" className="h-9 w-8 bg-muted/50 font-extrabold text-muted-foreground" disabled={disabled} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        className="h-9 w-full min-w-0 bg-transparent text-center font-extrabold outline-none"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(MAX_WINDOW_DAYS, Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))))}
      />
      <span className="px-2.5 text-xs font-semibold text-muted-foreground">days</span>
      <button type="button" className="h-9 w-8 bg-muted/50 font-extrabold text-muted-foreground" disabled={disabled} onClick={() => onChange(Math.min(MAX_WINDOW_DAYS, value + 1))}>
        +
      </button>
    </div>
  );
}

/** One cell of the edit / delete matrix. */
function Cell({ state, onClick, disabled, title }: { state: 'yes' | 'no' | 'locked' | 'description'; onClick?: () => void; disabled?: boolean; title: string }) {
  if (state === 'locked') {
    return (
      <span title={title} className="inline-grid h-[34px] w-[34px] place-items-center rounded-[10px] border-[1.5px] border-violet-200 bg-violet-100 text-violet-700">
        <Lock className="h-4 w-4" />
      </span>
    );
  }
  if (state === 'description') {
    return (
      <span title={title} className="inline-grid h-[34px] place-items-center rounded-[10px] border-[1.5px] border-amber-300 bg-amber-100 px-2 text-[11px] font-extrabold text-amber-800">
        Description only
      </span>
    );
  }
  const on = state === 'yes';
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled || !onClick}
      onClick={onClick}
      className={cn(
        'inline-grid h-[34px] w-[34px] place-items-center rounded-[10px] border-[1.5px] transition disabled:cursor-not-allowed',
        on ? 'border-green-300 bg-green-100 text-green-700' : 'border-border bg-muted/40 text-slate-300',
        disabled && 'opacity-50',
      )}
    >
      {on ? <Check className="h-4 w-4" strokeWidth={2.6} /> : <X className="h-4 w-4" strokeWidth={2.6} />}
    </button>
  );
}

export default function DailyRequisitionDataControlPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const { settings, meta, isLoading } = useDailyRequisitionSettings();

  const canView = can('View', 'Daily Requisition.Data Control') || can('View', 'Daily Requisition.Settings');
  const canEdit = can('Edit', 'Daily Requisition.Data Control');

  const [draft, setDraft] = useState<DRDataControl | null>(null);
  const [saving, setSaving] = useState(false);
  const [today] = useState(() => new Date());
  const [active, setActive] = useState<SectionId>('window');
  const [highValue, setHighValue] = useState<{ count: number; total: number; all: number } | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; who: string; whoId: string; what: string; at: Date | null }> | null>(null);

  const current = draft ?? settings.data;
  const liveFlat = useMemo(() => flattenDataControl(settings.data), [settings.data]);
  const currentFlat = useMemo(() => flattenDataControl(current), [current]);
  const changeCount = useMemo(() => Object.keys(diffFields(liveFlat, currentFlat)).length, [liveFlat, currentFlat]);
  const dirty = changeCount > 0;

  const issues = useMemo(
    () => validateDailyRequisitionSettings({ ...settings, data: current }).filter((issue) => issue.severity === 'error' || issue.section === 'dataControl'),
    [settings, current],
  );
  const blocked = hasBlockingIssue(issues);
  const risks = useMemo(() => risksOf(current), [current]);
  const score = scoreOf(risks);

  // How many entries the high-value flag would mark now, and what they add up to. Only for those
  // who can read the register; asked a moment after the amount stops changing.
  const threshold = current.highValueThreshold;
  useEffect(() => {
    if (!canView || authLoading || !threshold) return;
    let live = true;
    const timer = window.setTimeout(() => {
      Promise.all([
        getAggregateFromServer(query(collection(db, 'dailyRequisitions'), where('netAmount', '>=', threshold)), { n: count(), total: sum('netAmount') }),
        getCountFromServer(collection(db, 'dailyRequisitions')),
      ])
        .then(([flagged, all]) => live && setHighValue({ count: flagged.data().n, total: flagged.data().total ?? 0, all: all.data().count }))
        .catch(() => live && setHighValue(null));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [threshold, canView, authLoading]);

  // Who changed Data Control lately.
  useEffect(() => {
    if (!canView || authLoading) return;
    let live = true;
    getDocs(query(collection(db, 'userLogs'), where('module', '==', ACTIVITY_MODULES.DAILY_REQUISITION), orderBy('timestamp', 'desc'), limit(150)))
      .then((snap) => {
        if (!live) return;
        setRecent(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
            .filter((row) => row.action === 'Update Daily Requisition Data Control')
            .slice(0, 3)
            .map((row) => {
              const changes = (row.details?.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
              const [field, change] = Object.entries(changes)[0] ?? [];
              const more = Object.keys(changes).length - 1;
              return {
                id: row.id,
                who: String(row.userName || row.userEmail || 'Someone'),
                whoId: String(row.userId || row.id),
                what: field ? `${field}: ${String(change?.from)} → ${String(change?.to)}${more > 0 ? ` (+${more} more)` : ''}` : 'Saved Data Control',
                at: row.timestamp?.toDate ? row.timestamp.toDate() : null,
              };
            }),
        );
      })
      .catch(() => live && setRecent([]));
    return () => {
      live = false;
    };
  }, [canView, authLoading]);

  const set = (patch: Partial<DRDataControl>) => setDraft((previous) => ({ ...(previous ?? settings.data), ...patch }));
  const setDate = (patch: Partial<DRDateControl>) =>
    setDraft((previous) => {
      const base = previous ?? settings.data;
      return { ...base, dateControl: { ...base.dateControl, ...patch } };
    });

  const handleSave = async () => {
    if (!canEdit || blocked) return;
    setSaving(true);
    try {
      await saveDailyRequisitionSettings({ section: 'dataControl', next: { ...settings, data: current }, meta, user });
      const changes = diffFields(liveFlat, currentFlat);
      await log(
        'Update Daily Requisition Data Control',
        { changes, changedCount: Object.keys(changes).length },
        { recordId: DAILY_REQUISITION_SETTINGS_PATH.doc, recordRef: 'Data Control' },
      );
      setDraft(null);
      toast({ title: 'Data Control saved', description: 'The Entry Sheet applies the new rules straight away.' });
    } catch (error) {
      console.error('Failed to save Data Control:', error);
      toast({ variant: 'destructive', title: 'Save failed', description: 'The settings could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (isLoading && canView)) return <SettingsSkeleton />;
  if (!canView) return <SettingsAccessDenied title={TITLE} description={DESCRIPTION} />;

  const readOnly = !canEdit || saving;
  const dc = current.dateControl;
  const from = addDays(today, -dc.backdateDays);
  const to = addDays(today, dc.futureDays);
  const ringColour = score >= 80 ? '#4ade80' : score >= 50 ? '#fde047' : '#fb7185';
  const sectionHasRisk = (id: SectionId) => risks.some((r) => r.section === id);
  const editVerified = current.allowEditAfterReceived && current.allowEditAfterVerified;
  const deleteVerified = current.allowDeleteAfterReceived && current.allowDeleteAfterVerified;

  const nav: Array<{ id: SectionId; label: string }> = [
    { id: 'window', label: 'Date window' },
    { id: 'edit', label: 'Edit & delete' },
    { id: 'rules', label: 'Entry rules' },
    { id: 'register', label: 'Register & import' },
  ];

  return (
    <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1500px] pb-28')}>
      <style>{`
        @keyframes dr-data-drift { to { background-position: 100% 50%; } }
        .dr-data-hero { background-size: 140% 140%; animation: dr-data-drift 18s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .dr-data-hero { animation: none; } }
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
        <span className="text-foreground">Data Control</span>
      </nav>

      {/* Hero */}
      <section
        className="dr-data-hero relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[22px] p-5 text-white sm:px-[26px] sm:py-[22px]"
        style={{
          backgroundImage:
            'radial-gradient(520px 260px at 95% 0%, #38bdf8a0, transparent 65%), radial-gradient(560px 300px at 70% 120%, #7c3aedb0, transparent 65%), linear-gradient(115deg, #1e3a8a, #1d4ed8 40%, #4f46e5 75%, #7c3aed)',
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
        <span className="relative grid h-[54px] w-[54px] place-items-center rounded-2xl bg-white/15 shadow-[inset_0_1px_0_#ffffff40]">
          <Database className="h-6 w-6" />
        </span>
        <div className="relative min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Daily Requisition · Settings</div>
          <h1 className="text-2xl font-extrabold">{TITLE}</h1>
          <p className="text-white/85">{DESCRIPTION}</p>
        </div>
        <span className="flex-1" />
        <div className="relative flex items-center gap-3 rounded-[18px] border border-white/20 bg-white/10 py-2.5 pl-2.5 pr-4 backdrop-blur">
          <svg width="56" height="56" viewBox="0 0 36 36" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="#ffffff33" strokeWidth="4" />
            <circle cx="18" cy="18" r="15" fill="none" stroke={ringColour} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(94.2 * score) / 100} 94.2`} transform="rotate(-90 18 18)" />
            <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">
              {score}
            </text>
          </svg>
          <div>
            <b className="block text-[15px]">{score >= 80 ? 'Data well protected' : score >= 50 ? 'Some gaps in control' : 'Weak controls'}</b>
            <small className="text-xs text-blue-100">{risks.length ? `${risks.length} setting${risks.length === 1 ? '' : 's'} worth reviewing` : 'All checks pass'}</small>
          </div>
        </div>
        {!canEdit && <span className="relative rounded-full bg-white/15 px-2.5 py-0.5 text-[11.5px] font-bold">Read-only</span>}
      </section>

      {issues.length > 0 && (
        <div className="mt-3.5">
          <IssueList issues={issues} />
        </div>
      )}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[200px_minmax(0,1fr)_340px]">
        {/* Contents */}
        <nav className="sticky top-4 hidden rounded-[18px] border bg-card p-2 2xl:block" aria-label="Sections">
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => setActive(item.id)}
              className={cn(
                'flex items-center gap-2 rounded-[11px] px-2.5 py-2 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                active === item.id && 'bg-indigo-50 text-indigo-800',
              )}
            >
              {item.label}
              <i className={cn('ml-auto h-2 w-2 rounded-full', sectionHasRisk(item.id) ? 'bg-amber-500' : 'bg-green-500')} />
            </a>
          ))}
        </nav>

        <div>
          {/* 1 · Date window */}
          <Card
            id="window"
            icon={CalendarDays}
            from="#c4b5fd"
            to="#6d28d9"
            title="Reception date window"
            description="How far back or ahead a reception date may be on a new entry, or when a date is changed"
            aside={
              <>
                {dc.enabled ? (
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800">
                    On · {dc.backdateDays} back, {dc.futureDays} ahead
                  </span>
                ) : (
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11.5px] font-bold text-rose-700">Off</span>
                )}
                <Switch aria-label="Date window on" checked={dc.enabled} disabled={readOnly} onCheckedChange={(enabled) => setDate({ enabled })} />
              </>
            }
          >
            <div className="px-[18px] py-4">
              <span className="mb-1.5 block text-[11.5px] font-bold text-slate-600">Back-dating allowed</span>
              <div className={cn('inline-flex flex-wrap gap-0.5 rounded-[11px] bg-muted p-[3px]', !dc.enabled && 'pointer-events-none opacity-40')}>
                {DR_BACKDATE_PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setDate({ backdateDays: preset.days })}
                    className={cn('rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground', dc.backdateDays === preset.days && 'bg-card text-foreground shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]')}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-bold text-slate-600">Days back</span>
                  <Stepper label="Days back" value={dc.backdateDays} disabled={readOnly || !dc.enabled} onChange={(backdateDays) => setDate({ backdateDays })} />
                </div>
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-bold text-slate-600">Days ahead (future dates)</span>
                  <Stepper label="Days ahead" value={dc.futureDays} disabled={readOnly || !dc.enabled} onChange={(futureDays) => setDate({ futureDays })} />
                </div>
              </div>
              {/* The fortnight around today, with the days a reception date may take */}
              <div className="mt-3.5 flex gap-[3px] overflow-hidden">
                {Array.from({ length: 15 }, (_, i) => i - 10).map((offset) => {
                  const day = addDays(today, offset);
                  const inside = dc.enabled ? offset >= -dc.backdateDays && offset <= dc.futureDays : true;
                  return (
                    <div
                      key={offset}
                      className={cn(
                        'min-w-[26px] flex-1 rounded-[9px] bg-muted py-1 text-center text-[11px] font-bold leading-tight text-muted-foreground',
                        inside && 'bg-violet-100 text-violet-800',
                        offset > 0 && inside && 'bg-indigo-100 text-indigo-800',
                        offset === 0 && 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white',
                      )}
                    >
                      {format(day, 'EEEEEE')}
                      <b className="block text-[13px]">{format(day, 'd')}</b>
                    </div>
                  );
                })}
              </div>
              {dc.enabled ? (
                <p className="mt-2.5 flex items-center gap-2 text-[12.5px] text-slate-600">
                  <CalendarDays className="h-4 w-4 text-violet-600" />
                  <span>
                    Today a reception date can be <b>{format(from, 'd MMM')}</b> to <b>{format(to, 'd MMM')}</b>
                    {dc.futureDays ? '' : ' (no future dates)'}.
                  </span>
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-rose-300 bg-rose-50 px-3 py-2.5 text-[12.5px] font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  The window is off, so any date can be chosen — next year, or years ago.
                </p>
              )}
            </div>
            <Row
              title="Apply to bulk import"
              tip="Imported rows dated outside the window are skipped. Turn off to import old registers."
              control={<Switch aria-label="Apply to import" checked={dc.applyToImport} disabled={readOnly || !dc.enabled} onCheckedChange={(applyToImport) => setDate({ applyToImport })} />}
            />
          </Card>

          {/* 2 · Edit & delete */}
          <Card id="edit" icon={PencilLine} from="#fda4af" to="#be123c" title="Editing & deleting" description="What the Entry Sheet allows at each stage. Tap a box to allow or block.">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-2 py-2.5 pl-[18px] text-left">Stage</th>
                  <th className="px-2 py-2.5 text-center">Edit</th>
                  <th className="px-2 py-2.5 text-center">Delete</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    key: 'pending',
                    label: 'Pending',
                    colour: '#94a3b8',
                    hint: 'Entered, not yet received',
                    edit: <Cell state="yes" title="Always allowed" />,
                    del: <Cell state="yes" title="Always allowed" />,
                  },
                  {
                    key: 'received',
                    label: 'Received',
                    colour: '#0284c7',
                    hint: 'Finance has received it (or it was cancelled)',
                    edit: (
                      <Cell
                        state={current.allowEditAfterReceived ? 'yes' : 'no'}
                        title="Edit after received"
                        disabled={readOnly}
                        onClick={() => set(current.allowEditAfterReceived ? { allowEditAfterReceived: false, allowEditAfterVerified: false } : { allowEditAfterReceived: true })}
                      />
                    ),
                    del: (
                      <Cell
                        state={current.allowDeleteAfterReceived ? 'yes' : 'no'}
                        title="Delete after received"
                        disabled={readOnly}
                        onClick={() => set(current.allowDeleteAfterReceived ? { allowDeleteAfterReceived: false, allowDeleteAfterVerified: false } : { allowDeleteAfterReceived: true })}
                      />
                    ),
                  },
                  {
                    key: 'verified',
                    label: 'Verified',
                    colour: '#7c3aed',
                    hint: 'Verified at GST & TDS, flagged, or sent for payment',
                    edit: (
                      <Cell
                        state={editVerified ? 'yes' : 'no'}
                        title="Edit after verified"
                        disabled={readOnly}
                        onClick={() => set(editVerified ? { allowEditAfterVerified: false } : { allowEditAfterVerified: true, allowEditAfterReceived: true })}
                      />
                    ),
                    del: (
                      <Cell
                        state={deleteVerified ? 'yes' : 'no'}
                        title="Delete after verified"
                        disabled={readOnly}
                        onClick={() => set(deleteVerified ? { allowDeleteAfterVerified: false } : { allowDeleteAfterVerified: true, allowDeleteAfterReceived: true })}
                      />
                    ),
                  },
                  {
                    key: 'paid',
                    label: 'Paid',
                    colour: '#16a34a',
                    hint: 'Paid via Bank Balance, or marked paid',
                    edit: <Cell state="description" title="Only the description can change" />,
                    del: <Cell state="locked" title="Never deleted" />,
                  },
                ].map((row) => (
                  <tr key={row.key}>
                    <td className="border-t px-2 py-2.5 pl-[18px] text-left font-bold">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                        <i className="h-[9px] w-[9px] rounded-full" style={{ background: row.colour }} />
                        {row.label}
                        <InfoTip label={`About “${row.label}”`}>{row.hint}</InfoTip>
                      </span>
                    </td>
                    <td className="border-t px-2 py-2.5 text-center">{row.edit}</td>
                    <td className="border-t px-2 py-2.5 text-center">{row.del}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-start gap-2 border-t border-violet-100 bg-violet-50 px-[18px] py-3 text-[12.5px] text-violet-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <b>Payment locks always apply.</b> An entry paid through Bank Balance, or marked paid, can&apos;t be deleted, and only its description can be edited,
                whatever is set here.
              </span>
            </div>
          </Card>

          {/* 3 · Entry rules */}
          <Card id="rules" icon={ShieldCheck} from="#86efac" to="#15803d" title="Entry rules" description="Checks applied when an entry is added or edited">
            <Row
              title="Require an expense request (DEP No.)"
              tip="New entries must be received from an expense request. Imports are not affected."
              control={<Switch aria-label="Require expense request" checked={current.requireExpenseRequest} disabled={readOnly} onCheckedChange={(requireExpenseRequest) => set({ requireExpenseRequest })} />}
            />
            <Row
              title="Allow net amount above gross"
              hint={current.netMayExceedGross ? 'On: an entry with net higher than gross is accepted.' : 'Off: an entry whose net amount is higher than its gross is refused.'}
              risky={current.netMayExceedGross}
              control={<Switch aria-label="Net may exceed gross" checked={current.netMayExceedGross} disabled={readOnly} onCheckedChange={(netMayExceedGross) => set({ netMayExceedGross })} />}
            />
            <Row title="High-value flag" tip="Rows at or above this amount are highlighted in the register.">
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <div className="flex w-[160px] items-center rounded-[11px] border px-2.5">
                  <span className="font-extrabold text-muted-foreground">₹</span>
                  <input
                    aria-label="High-value threshold"
                    inputMode="numeric"
                    className="w-full bg-transparent py-1.5 pl-1.5 text-right font-extrabold outline-none"
                    value={threshold ? threshold.toLocaleString('en-IN') : ''}
                    placeholder="Off"
                    disabled={readOnly}
                    onChange={(e) => set({ highValueThreshold: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {THRESHOLD_PRESETS.map((preset) => (
                    <button
                      key={preset.amount}
                      type="button"
                      disabled={readOnly}
                      onClick={() => set({ highValueThreshold: preset.amount })}
                      className={cn('rounded-full border bg-card px-2.5 py-0.5 text-xs font-bold text-muted-foreground', threshold === preset.amount && 'border-violet-400 bg-violet-50 text-violet-700')}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1.5 rounded-[10px] bg-muted px-2.5 py-1.5 text-xs text-slate-600">
                {!threshold
                  ? 'Off: no rows are highlighted.'
                  : highValue
                    ? (
                      <>
                        Right now <b>{highValue.count.toLocaleString('en-IN')}</b> of {highValue.all.toLocaleString('en-IN')} entries would be flagged, worth{' '}
                        <b>{compactInr(highValue.total)}</b>.
                      </>
                    )
                    : `Entries of ${inr.format(threshold)} or more are highlighted.`}
              </p>
            </Row>
          </Card>

          {/* 4 · Register & import */}
          <Card id="register" icon={Upload} from="#7dd3fc" to="#0369a1" title="Register & import" description="Defaults for the Entry Sheet list and its bulk import">
            <Row
              title="Default date range"
              tip="What the Entry Sheet's list is filtered to when it opens. People can change it there; a link to one entry always shows it."
              control={
                <div className="inline-flex flex-wrap gap-0.5 rounded-[11px] bg-muted p-[3px]">
                  {DR_DATE_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      disabled={readOnly}
                      onClick={() => set({ defaultDateRange: preset.value as DRDatePreset })}
                      className={cn('rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground', current.defaultDateRange === preset.value && 'bg-card text-foreground shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]')}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              }
            />
            <Row
              title="Detect duplicates on import"
              tip="Skip rows that repeat an entry already recorded. Reception numbers are always unique."
              control={<Switch aria-label="Detect duplicates" checked={current.importDuplicateDetection} disabled={readOnly} onCheckedChange={(importDuplicateDetection) => set({ importDuplicateDetection })} />}
            >
              <div className={cn('mt-2 flex flex-wrap gap-1.5', !current.importDuplicateDetection && 'opacity-40')}>
                {DUPLICATE_FIELDS.map((field) => (
                  <span key={field} className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-700">
                    ✓ {field}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {current.importDuplicateDetection ? 'A row counts as a duplicate when all of these match an entry already recorded.' : 'Off: repeated rows are imported again.'}
              </p>
            </Row>
          </Card>

          <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {describeLastUpdate(meta.dataControl)}
            {canEdit && (
              <>
                <span aria-hidden>·</span>
                <button type="button" className="font-bold text-indigo-700 hover:underline" onClick={() => setDraft(defaultDataControl())}>
                  Reset to defaults
                </button>
              </>
            )}
          </div>
        </div>

        {/* Risk check */}
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <section className="overflow-hidden rounded-[20px] border bg-card">
            <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <b>Risk check</b>
              {risks.length ? (
                <span className={cn('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', risks.some((r) => r.level === 'bad') ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>
                  {risks.length} to review
                </span>
              ) : (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800">All good</span>
              )}
            </header>
            <div className="px-4 pb-3.5">
              {risks.length === 0 ? (
                <div className="py-2.5 text-center text-muted-foreground">
                  <span className="mx-auto mb-1 grid h-10 w-10 place-items-center rounded-xl bg-green-100 text-green-700">
                    <Check className="h-5 w-5" />
                  </span>
                  No risky settings
                </div>
              ) : (
                risks.map((risk) => (
                  <div key={risk.id} className="flex gap-2.5 border-b border-dashed py-2.5 last:border-b-0">
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-[9px]', risk.level === 'bad' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>
                      <AlertTriangle className="h-[15px] w-[15px]" />
                    </span>
                    <div className="min-w-0">
                      <b className="block text-[12.5px] leading-snug">{risk.title}</b>
                      <small className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{risk.why}</small>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setDraft(risk.apply(current))}
                          className="mt-1.5 rounded-full border bg-card px-2.5 py-0.5 text-[11.5px] font-bold text-indigo-700 hover:bg-indigo-50"
                        >
                          {risk.fix}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="overflow-hidden rounded-[20px] border bg-card">
            <header className="px-4 pb-2 pt-3.5">
              <b>Recent changes</b>
            </header>
            <div className="px-4 pb-3.5">
              {recent === null ? (
                <p className="py-1 text-xs text-muted-foreground">Loading…</p>
              ) : recent.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">No changes recorded.</p>
              ) : (
                recent.map((row) => (
                  <div key={row.id} className="flex gap-2 py-1.5 text-xs">
                    <Avatar id={row.whoId} name={row.who} size="sm" />
                    <span className="min-w-0">
                      <span className="block break-words">{row.what}</span>
                      <small className="block text-muted-foreground">
                        {row.who}
                        {row.at ? ` · ${format(row.at, 'd MMM yyyy, h:mm a')}` : ''}
                      </small>
                    </span>
                  </div>
                ))
              )}
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
          <b className="text-violet-300">{changeCount}</b> unsaved change{changeCount === 1 ? '' : 's'}
          {blocked ? <span className="block text-xs text-rose-300">Fix the errors above to save.</span> : null}
        </span>
        <Button variant="outline" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setDraft(null)} disabled={saving}>
          Discard
        </Button>
        <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => void handleSave()} disabled={saving || blocked}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
