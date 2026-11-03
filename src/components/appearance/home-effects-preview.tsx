'use client';

/**
 * Settings › Appearance › Branding › Home page: the option thumbnails and the live preview for the
 * Aurora Glass home page's backgrounds. The effects are the home page's own (`BannerFx`,
 * `ModulesFx`, `useFxPointer`); only the content in front of them is sketched — sample modules and
 * no links, so nothing in the preview navigates.
 */

import type { CSSProperties } from 'react';
import { BarChart3, FileCheck, Landmark, Receipt, Route, Search, User, type LucideIcon } from 'lucide-react';
import { BannerFx, ModulesFx, modulesAreaClass, useFxPointer } from '@/components/home/home-effects';
import type { HomeBannerEffect, HomeModulesEffect } from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

/** Aurora Glass's frosted surface, as on the home page (src/components/home/launchpad-home.tsx). */
const glass =
  'border border-white/80 bg-white/55 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.25)] dark:border-white/10 dark:bg-card/60';

/** The home page's own glow behind everything, so the frosted cards read as they do there. */
function PageGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          backgroundColor: '#f5f7fb',
          backgroundImage:
            'radial-gradient(700px 500px at 8% 0%, #99f6e4 0%, transparent 60%), radial-gradient(600px 500px at 95% 10%, #c7d2fe 0%, transparent 60%), radial-gradient(700px 600px at 60% 100%, #fbcfe8 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 hidden bg-background dark:block"
        style={{
          backgroundImage:
            'radial-gradient(700px 500px at 8% 0%, rgba(20,184,166,0.16) 0%, transparent 60%), radial-gradient(600px 500px at 95% 10%, rgba(99,102,241,0.16) 0%, transparent 60%)',
        }}
      />
    </div>
  );
}

/* ── Thumbnails ──────────────────────────────────────────────────────────────────────────── */

export function BannerEffectThumb({ effect }: { effect: HomeBannerEffect }) {
  return (
    // The plain page colour, not the home page glow: at this size the glow drowned every effect.
    <span className="relative isolate block h-16 overflow-hidden rounded-lg border bg-background">
      <span className={cn('absolute inset-1.5 isolate flex flex-col justify-center gap-1 overflow-hidden rounded-md px-2', glass)}>
        <BannerFx effect={effect} />
        <span className="h-1 w-10 rounded-full bg-gradient-to-r from-teal-600 to-indigo-500" />
        <span className="h-1.5 w-16 rounded-full bg-gradient-to-r from-teal-700 via-indigo-600 to-pink-600" />
        <span className="keep-light h-2.5 w-20 rounded-sm bg-white shadow-sm dark:bg-card" />
      </span>
    </span>
  );
}

export function ModulesEffectThumb({ effect }: { effect: HomeModulesEffect }) {
  return (
    // The plain page colour, not the home page glow: at this size the glow drowned every effect.
    <span className="relative isolate block h-16 overflow-hidden rounded-lg border bg-background">
      <span className={cn('absolute inset-0 isolate grid grid-cols-5 content-center gap-1 p-1.5', effect === 'none' ? '' : 'overflow-hidden')}>
        <ModulesFx effect={effect} />
        {Array.from({ length: 10 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              'flex h-5 items-center justify-center rounded-[5px]',
              glass,
              // Card glow lives on hover; the thumbnail shows one tile caught mid-glow.
              effect === 'card-glow' && index === 2 && 'bg-indigo-100/80 shadow-[0_0_0_1.5px_#6366f1,0_6px_12px_-6px_#6366f1] dark:bg-indigo-500/20',
            )}
          >
            <span className="h-2 w-2 rounded-[3px] bg-gradient-to-br from-teal-500 to-indigo-500" />
          </span>
        ))}
      </span>
    </span>
  );
}

/* ── Preview ─────────────────────────────────────────────────────────────────────────────── */

const SAMPLE_MODULES: Array<{ label: string; Icon: LucideIcon; from: string; to: string }> = [
  { label: 'E-Approval', Icon: FileCheck, from: '#60a5fa', to: '#1d4ed8' },
  { label: 'Bank Balance', Icon: Landmark, from: '#818cf8', to: '#3730a3' },
  { label: 'Expenses', Icon: Receipt, from: '#fb7185', to: '#e11d48' },
  { label: 'Employee', Icon: User, from: '#f9a8d4', to: '#db2777' },
  { label: 'Fleet & Travel', Icon: Route, from: '#a3e635', to: '#4d7c0f' },
  { label: 'Bill Tracking', Icon: BarChart3, from: '#34d399', to: '#047857' },
];

const greetingNow = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

const FIGURES = [
  { label: 'Needs you', value: '2', note: 'in 1 module', edge: 'from-blue-400 to-blue-700' },
  { label: 'Overdue', value: '1', note: 'past their deadline', edge: 'from-orange-300 to-orange-600' },
  { label: 'Meetings today', value: '0', note: 'in Office Hub', edge: 'from-pink-400 to-rose-600' },
];

/**
 * The Aurora Glass home page in small, with the draft's backgrounds. Move the mouse over the tiles
 * to see Cursor spotlight and Card glow — they follow the pointer exactly as on the home page.
 */
export function HomeEffectsPreview({ banner, modules, firstName }: { banner: HomeBannerEffect; modules: HomeModulesEffect; firstName: string }) {
  const modulesRef = useFxPointer<HTMLDivElement>(modules);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="relative isolate overflow-hidden rounded-xl border p-3 sm:p-4">
      <PageGlow />

      <div className={cn(glass, 'flex flex-col gap-4 rounded-2xl p-4 lg:flex-row lg:items-center lg:justify-between', banner === 'none' ? 'backdrop-blur-[16px]' : 'relative isolate overflow-hidden')}>
        <BannerFx effect={banner} />
        <div className="min-w-0">
          <p className="w-fit bg-gradient-to-r from-teal-600 to-indigo-500 bg-clip-text text-[11px] font-bold uppercase tracking-[0.08em] text-transparent dark:from-teal-300 dark:to-indigo-300">
            {today}
          </p>
          <p className="mt-1 text-xl font-extrabold tracking-[-0.025em]">
            <span className="bg-gradient-to-r from-teal-700 via-indigo-600 via-60% to-pink-600 bg-clip-text text-transparent dark:from-teal-300 dark:via-indigo-300 dark:to-pink-300">
              {greetingNow()}
            </span>
            , {firstName}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            You have <strong className="font-bold text-foreground">2 items</strong> waiting for you across 1 module.
          </p>
          <div className="mt-3 flex h-9 max-w-sm items-center gap-2 rounded-xl bg-white px-3 text-xs text-slate-400 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.19)] dark:bg-card">
            <Search className="h-4 w-4" aria-hidden="true" /> Search modules…
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 lg:w-[26rem] lg:shrink-0">
          {FIGURES.map((figure) => (
            <div key={figure.label} className="relative min-w-0 overflow-hidden rounded-[14px] bg-white p-2.5 dark:bg-card">
              <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', figure.edge)} />
              <span className="block text-[11px] font-semibold leading-tight text-slate-400">{figure.label}</span>
              <span className="my-0.5 block text-lg font-extrabold tabular-nums">{figure.value}</span>
              <span className="block text-[11px] leading-tight text-slate-600 dark:text-slate-300">{figure.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={modulesRef} className={cn('mt-3 space-y-2', modulesAreaClass(modules))}>
        <ModulesFx effect={modules} />
        <p className="text-[13px] font-bold">
          All modules <span className="text-xs font-semibold text-muted-foreground">· {SAMPLE_MODULES.length}</span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {SAMPLE_MODULES.map(({ label, Icon, from, to }) => (
            <div
              key={label}
              data-fx-tile=""
              style={{ '--accent-30': `${to}4d`, '--accent-solid': to, '--accent-70': `${to}b3` } as CSSProperties}
              className={cn(glass, 'relative flex flex-col items-center rounded-2xl px-2 pb-3 pt-4 text-center transition duration-200 hover:-translate-y-1')}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                style={{ background: `linear-gradient(145deg, ${from}, ${to})`, boxShadow: `0 6px 14px -5px ${to}` }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-2 block text-xs font-bold leading-snug">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
