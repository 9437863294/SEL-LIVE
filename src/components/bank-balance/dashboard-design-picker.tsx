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
 * Bank Balance › Settings › Dashboard design: which layout the dashboard opens in, for everyone.
 * Each option can be previewed on the real dashboard (`/bank-balance?design=…`) before saving.
 */
export function DashboardDesignPicker({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const [saved, setSaved] = useState<DashboardDesignSetting | null>(null);
  const [choice, setChoice] = useState<BankDashboardDesign>('classic');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readDashboardDesign().then((setting) => {
      if (cancelled) return;
      setSaved(setting);
      setChoice(setting.design);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = saved !== null && choice !== saved.design;

  const save = async () => {
    if (!canEdit || !saved || !dirty || !user?.id) return;
    setSaving(true);
    try {
      await saveDashboardDesign(choice, { id: user.id, name: user.name || '' });
      void log(
        'Update Dashboard Design',
        { changes: diffFields({ design: dashboardDesignLabel(saved.design) }, { design: dashboardDesignLabel(choice) }) },
        { recordId: 'dashboard', recordRef: 'Dashboard design' },
      );
      setSaved({ design: choice, updatedByName: user.name || '', updatedAt: new Date() });
      toast({ title: 'Dashboard design saved', description: `Bank Balance now opens in ${dashboardDesignLabel(choice)} for everyone.` });
    } catch (error) {
      console.error('Could not save the dashboard design:', error);
      toast({ title: 'Could not save', description: 'The dashboard design was not saved. Check your access and try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Dashboard design" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {BANK_DASHBOARD_DESIGNS.map((option) => {
          const Sketch = SKETCH[option.id];
          const selected = choice === option.id;
          const inUse = saved?.design === option.id;
          return (
            <div
              key={option.id}
              className={cn(
                'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow',
                selected ? 'border-primary ring-2 ring-primary/30' : 'hover:shadow-md',
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canEdit || saved === null}
                onClick={() => setChoice(option.id)}
                className="flex flex-1 flex-col text-left disabled:cursor-default"
              >
                <div className="aspect-[16/10] w-full border-b bg-muted/40 p-3" aria-hidden>
                  <Sketch />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="font-semibold text-foreground">{option.label}</span>
                    {inUse && (
                      <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        In use
                      </span>
                    )}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                </div>
              </button>
              <div className="border-t px-3 py-2">
                <Link
                  href={`/bank-balance?design=${option.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Eye aria-hidden className="h-3.5 w-3.5" />
                  Preview with today’s figures
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm">
        <p className="min-w-0 text-muted-foreground">
          {saved === null ? (
            'Reading the saved design…'
          ) : (
            <>
              Everyone sees <b className="text-foreground">{dashboardDesignLabel(saved.design)}</b>
              {saved.updatedByName ? ` · set by ${saved.updatedByName}` : ''}
              {saved.updatedAt ? ` on ${format(saved.updatedAt, 'd MMM yyyy, HH:mm')}` : ''}.
            </>
          )}
        </p>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => saved && setChoice(saved.design)} disabled={saving}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save design'}
            </Button>
          </div>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock aria-hidden className="h-3.5 w-3.5" />
            Changing it needs Edit on Bank Balance › Payment Entry Settings
          </p>
        )}
      </div>
    </div>
  );
}
