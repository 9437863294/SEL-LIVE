'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentType } from 'react';
import { format } from 'date-fns';
import { Check, Eye, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { BANK_DASHBOARD_DESIGNS, dashboardDesignLabel, type BankDashboardDesign } from '@/lib/bank-balance-dashboard';
import { readDashboardDesign, saveDashboardDesign, type DashboardDesignSetting } from '@/components/bank-balance/dashboard-designs';
import { cn } from '@/lib/utils';

/* ── Layout sketches: enough to tell the five apart at a glance, no figures. ─────────────────── */

const Block = ({ className }: { className?: string }) => <div className={cn('rounded-[3px] bg-slate-200 dark:bg-slate-700', className)} />;

function ClassicSketch() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="h-5 rounded-md bg-gradient-to-r from-violet-300 via-violet-200 to-sky-200 dark:from-violet-800 dark:via-violet-900 dark:to-sky-900" />
      <div className="grid grid-cols-3 gap-1.5">
        <Block className="h-3 bg-emerald-200 dark:bg-emerald-900" />
        <Block className="h-3 bg-rose-200 dark:bg-rose-900" />
        <Block className="h-3 bg-sky-200 dark:bg-sky-900" />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 4 }, (_, i) => <Block key={i} className="h-4" />)}
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1.5">
        {Array.from({ length: 3 }, (_, i) => <Block key={i} className="h-full border-t-2 border-violet-300 dark:border-violet-700" />)}
      </div>
    </div>
  );
}

function OverviewSketch() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Block className="h-1.5 w-8" />
      <div className="h-3 w-24 rounded-[3px] bg-slate-700 dark:bg-slate-300" />
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
        <path d="M0 20 L12 18 L24 15 L36 16 L48 16 L58 12 L68 6 L80 5 L88 10 L94 12 L100 5 L100 24 L0 24 Z" className="fill-teal-100 dark:fill-teal-950" />
        <path d="M0 20 L12 18 L24 15 L36 16 L48 16 L58 12 L68 6 L80 5 L88 10 L94 12 L100 5" fill="none" strokeWidth="1.5" className="stroke-teal-600 dark:stroke-teal-400" />
      </svg>
      <div className="grid flex-1 grid-cols-[2fr_1fr] gap-2">
        <div className="space-y-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200 dark:bg-slate-700" />
              <Block className="h-1.5 flex-1" />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Block className="h-6 border border-slate-300 bg-transparent dark:border-slate-600 dark:bg-transparent" />
          <Block className="h-5 border border-slate-300 bg-transparent dark:border-slate-600 dark:bg-transparent" />
        </div>
      </div>
    </div>
  );
}

function AccountsSketch() {
  return (
    <div className="grid h-full grid-cols-[1fr_2.6fr] gap-2">
      <div className="space-y-1 rounded-md border border-slate-200 p-1 dark:border-slate-700">
        <div className="h-2.5 rounded-[3px] bg-teal-100 dark:bg-teal-950" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-slate-800 dark:bg-slate-300" />
            <Block className="h-1 flex-1" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }, (_, i) => <Block key={i} className="h-4 border border-slate-200 bg-transparent dark:border-slate-700 dark:bg-transparent" />)}
        </div>
        <div className="flex h-8 items-end gap-[2px] rounded-md border border-slate-200 p-1 dark:border-slate-700">
          {[5, 5, 4, 4, 3, 3, 3, 2, 2, 3, 3, 4, 5, 5, 6, 6].map((h, i) => (
            <span key={i} className="flex flex-1 flex-col justify-end bg-slate-200 dark:bg-slate-700" style={{ height: '100%' }}>
              <span className="bg-slate-800 dark:bg-slate-300" style={{ height: `${h * 12}%` }} />
            </span>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-[1fr_1.6fr] gap-1">
          <Block className="h-full border border-slate-200 bg-transparent dark:border-slate-700 dark:bg-transparent" />
          <Block className="h-full border border-slate-200 bg-transparent dark:border-slate-700 dark:bg-transparent" />
        </div>
      </div>
    </div>
  );
}

function PositionSketch() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="grid grid-cols-[3fr_1fr] gap-1.5 rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1">
            <Block className="h-2.5" />
            <Block className="h-2.5" />
            <Block className="h-2.5 bg-teal-200 dark:bg-teal-900" />
          </div>
          <div className="flex gap-[2px]">
            {[5, 2.5, 5, 5, 5].map((grow, i) => (
              <div key={i} style={{ flexGrow: grow, flexBasis: 0 }}>
                <Block className="h-1.5" />
              </div>
            ))}
          </div>
        </div>
        <Block className="h-full bg-slate-100 dark:bg-slate-800" />
      </div>
      <Block className="h-3 border border-slate-200 bg-transparent dark:border-slate-700 dark:bg-transparent" />
      <div className="flex-1 space-y-[3px] rounded-md border border-slate-200 p-1 dark:border-slate-700">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-1">
            <Block className={cn('h-1', i === 0 && 'bg-slate-300 dark:bg-slate-600')} />
            <Block className="h-1" />
            <Block className="h-1" />
            <Block className="h-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AuroraSketch() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="grid h-8 grid-cols-2 gap-1.5 rounded-md bg-gradient-to-r from-teal-600 via-blue-600 to-pink-600 p-1.5">
        <div className="space-y-1">
          <div className="h-1 w-8 rounded-sm bg-white/60" />
          <div className="h-2 w-16 rounded-sm bg-white" />
        </div>
        <div className="rounded-sm border border-white/40 bg-white/15" />
      </div>
      <div className="grid grid-cols-4 gap-1">
        {['bg-emerald-400', 'bg-rose-400', 'bg-indigo-400', 'bg-sky-400'].map((c) => (
          <div key={c} className="flex items-center gap-0.5 rounded-[3px] border border-slate-200 p-0.5 dark:border-slate-700">
            <span className={cn('h-1.5 w-1.5 rounded-[2px]', c)} />
            <Block className="h-1 flex-1" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-1.5">
        <div className="space-y-1 rounded-[3px] border border-slate-200 p-1 dark:border-slate-700">
          {[80, 55, 40].map((w, i) => (
            <div key={i} className="h-1 rounded-full bg-slate-200 dark:bg-slate-700">
              <div className={cn('h-full rounded-full', i === 0 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center rounded-[3px] border border-slate-200 dark:border-slate-700">
          <span className="h-5 w-5 rounded-full border-[3px] border-blue-400 border-r-orange-400 border-t-emerald-400" />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {Array.from({ length: 3 }, (_, i) => <Block key={i} className="h-full border border-slate-200 bg-transparent dark:border-slate-700 dark:bg-transparent" />)}
      </div>
    </div>
  );
}

const SKETCH: Record<BankDashboardDesign, ComponentType> = {
  classic: ClassicSketch,
  overview: OverviewSketch,
  accounts: AccountsSketch,
  position: PositionSketch,
  aurora: AuroraSketch,
};

/**
 * Bank Balance › Settings › Appearance: which layout the dashboard opens in, for everyone.
 *
 * The design in use is shown large; the others sit beside it to pick from. Picking one brings up
 * a bar to apply it for everyone. Previewing is optional — each design can be opened on the real
 * dashboard with today's figures (`/bank-balance?design=…`, seen only by the viewer), but nothing
 * has to be previewed before it is applied.
 */
export function DashboardDesignPicker({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const [saved, setSaved] = useState<DashboardDesignSetting | null>(null);
  const [choice, setChoice] = useState<BankDashboardDesign | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readDashboardDesign().then((setting) => {
      if (!cancelled) setSaved(setting);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const inUse = saved?.design ?? 'classic';
  const current = BANK_DASHBOARD_DESIGNS.find((option) => option.id === inUse) ?? BANK_DASHBOARD_DESIGNS[0];
  const others = BANK_DASHBOARD_DESIGNS.filter((option) => option.id !== inUse);
  const pending = choice && choice !== inUse ? choice : null;
  const CurrentSketch = SKETCH[current.id];

  const apply = async () => {
    if (!canEdit || !saved || !pending || !user?.id) return;
    setSaving(true);
    try {
      await saveDashboardDesign(pending, { id: user.id, name: user.name || '' });
      void log(
        'Update Dashboard Design',
        { changes: diffFields({ design: dashboardDesignLabel(saved.design) }, { design: dashboardDesignLabel(pending) }) },
        { recordId: 'dashboard', recordRef: 'Dashboard design' },
      );
      setSaved({ design: pending, updatedByName: user.name || '', updatedAt: new Date() });
      setChoice(null);
      toast({ title: 'Dashboard design applied', description: `Everyone now sees ${dashboardDesignLabel(pending)}.` });
    } catch (error) {
      console.error('Could not save the dashboard design:', error);
      toast({ title: 'Could not save', description: 'The dashboard design was not saved. Check your access and try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const initials = (name?: string) =>
    (name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '—';

  return (
    <>
      <div className="grid grid-cols-1 gap-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* What everyone sees now */}
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-gradient-to-br from-slate-50 to-indigo-50 p-4 dark:from-slate-900/60 dark:to-indigo-950/40">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 normal-case tracking-normal text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <Check aria-hidden className="h-3 w-3" /> In use
            </span>
            What everyone sees now
          </div>
          <div className="relative aspect-video overflow-hidden rounded-lg border bg-white p-4 shadow-[0_20px_40px_-24px_rgba(30,41,59,0.5)] dark:bg-slate-900" aria-hidden>
            {saved ? <CurrentSketch /> : <div className="h-full animate-pulse rounded bg-muted" />}
          </div>
          <div>
            <h3 className="text-lg font-extrabold tracking-tight text-foreground">{saved ? current.label : 'Reading…'}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{current.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            {saved?.updatedByName ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-[9.5px] font-bold text-white">
                  {initials(saved.updatedByName)}
                </span>
                Set by {saved.updatedByName}
                {saved.updatedAt ? ` · ${format(saved.updatedAt, 'd MMM yyyy, h:mm a')}` : ''}
              </span>
            ) : (
              <span>{saved ? 'The built-in default — nobody has chosen a design yet.' : ''}</span>
            )}
            {/* No preview here: the design in use is what the dashboard already shows. */}
          </div>
        </div>

        {/* The alternatives */}
        <div className="min-w-0">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="text-sm font-bold text-foreground">Other designs</h4>
            <span className="text-xs font-semibold text-muted-foreground">
              {canEdit ? 'Pick one and apply — previewing is optional' : 'Preview any of them with today’s figures'}
            </span>
          </div>
          <div role="radiogroup" aria-label="Dashboard design" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {others.map((option) => {
              const Sketch = SKETCH[option.id];
              const selected = pending === option.id;
              return (
                <div
                  key={option.id}
                  className={cn(
                    'relative min-w-0 rounded-xl border bg-card p-2 transition',
                    selected ? 'border-violet-600 ring-[3px] ring-violet-600/15' : 'hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md',
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!canEdit || !saved || saving}
                    onClick={() => setChoice(selected ? null : option.id)}
                    className="block w-full text-left disabled:cursor-default"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden rounded-lg border bg-muted/40 p-2" aria-hidden>
                      <Sketch />
                    </div>
                    <span className="mx-1 mt-2 flex items-center gap-2 text-[13px] font-bold text-foreground">
                      <span
                        aria-hidden
                        className={cn('h-[15px] w-[15px] shrink-0 rounded-full border-2', selected ? 'border-[5px] border-violet-600' : 'border-slate-300 dark:border-slate-600')}
                      />
                      {option.label}
                    </span>
                    <span className="mx-1 mb-0.5 mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{option.description.split('.')[0]}.</span>
                  </button>
                  <Link
                    href={`/bank-balance?design=${option.id}`}
                    className="mx-1 mb-0.5 mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    <Eye aria-hidden className="h-3.5 w-3.5" />
                    Preview
                  </Link>
                </div>
              );
            })}
          </div>
          {!canEdit && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock aria-hidden className="h-3.5 w-3.5" />
              Changing it needs Edit on Bank Balance › Payment Entry Settings
            </p>
          )}
        </div>
      </div>

      {/* Apply bar: appears once a different design is picked. Above the phone's tab bar. */}
      <div
        role="region"
        aria-label="Apply dashboard design"
        className={cn(
          'fixed bottom-24 left-1/2 z-40 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl bg-slate-900 py-2.5 pl-4 pr-2.5 text-sm text-white shadow-[0_20px_50px_-10px_rgba(15,23,42,0.55)] transition-all duration-200 lg:bottom-6 dark:bg-slate-800',
          pending ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
        )}
      >
        <span>
          Switch everyone’s dashboard to <b className="text-violet-300">{pending ? dashboardDesignLabel(pending) : ''}</b>?
        </span>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => setChoice(null)}
            disabled={saving}
            tabIndex={pending ? 0 : -1}
          >
            Cancel
          </Button>
          <Button size="sm" className="bg-white text-slate-900 hover:bg-slate-100" onClick={() => void apply()} disabled={saving || !pending} tabIndex={pending ? 0 : -1}>
            {saving ? 'Applying…' : 'Apply for everyone'}
          </Button>
        </span>
      </div>
    </>
  );
}
