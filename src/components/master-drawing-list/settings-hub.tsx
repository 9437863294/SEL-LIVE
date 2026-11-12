'use client';

/**
 * Master Drawing List › Settings: one card per settings page, each saying how it is set now. The
 * module's sidebar keeps a single Settings entry; these cards are the way into its pages.
 */

import Link from 'next/link';
import { BookmarkCheck, CalendarClock, ChevronRight, Layers, ListChecks, Settings2, SlidersHorizontal, type LucideIcon } from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { MDL_FORM_KEYS, activeNames, describeDateRule } from '@/lib/master-drawing-list/settings';
import type { MappingTemplate } from '@/lib/master-drawing-list/workbook-import';
import { cn } from '@/lib/utils';

import { useMdl, useMdlQuery, useMdlSettings } from './mdl-client';
import { MdlLoading } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';

interface Card {
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  state: string;
  gradient: string;
  bg: string;
  iconColor: string;
}

export default function SettingsHub() {
  const { lookups, can } = useMdl();
  const settings = useMdlSettings();
  const canSeeMappings = can('Import', 'View');
  const mappings = useMdlQuery<{ templates: MappingTemplate[] }>(canSeeMappings ? 'import/mappings' : null);
  if (!lookups) return <MdlLoading />;
  const saved = mappings.data?.templates.length;
  const overrides = MDL_FORM_KEYS.reduce((sum, form) => sum + Object.keys(settings.fieldControl[form] ?? {}).length, 0);
  const ownRules = Object.keys(settings.dateControl.projects ?? {}).length;
  const cards: Card[] = [
    {
      icon: Layers,
      title: 'Drawing Lists',
      href: `${MDL_BASE}/settings/projects`,
      description: 'Create drawing lists, link each to its ERP project, and set the client review and resubmission periods.',
      state: `${lookups.projects.length} drawing list${lookups.projects.length === 1 ? '' : 's'}`,
      gradient: 'from-sky-500 to-blue-600',
      bg: 'bg-sky-50',
      iconColor: 'text-sky-600',
    },
    {
      icon: ListChecks,
      title: 'Schedules & Scopes',
      href: `${MDL_BASE}/settings/master-data`,
      description: 'The lists every drawing is filed under — add, rename, reorder or switch off values.',
      state: `${activeNames(settings.masterData.schedules).join(', ')} · ${activeNames(settings.masterData.scopes).join(', ')}`,
      gradient: 'from-emerald-500 to-teal-600',
      bg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
    {
      icon: SlidersHorizontal,
      title: 'Field Control',
      href: `${MDL_BASE}/settings/field-control`,
      description: 'For each form, rename fields, show or hide them, and make them required or optional.',
      state: overrides ? `${overrides} field${overrides === 1 ? '' : 's'} changed from the defaults` : 'Defaults',
      gradient: 'from-violet-500 to-purple-600',
      bg: 'bg-violet-50',
      iconColor: 'text-violet-600',
    },
    {
      icon: CalendarClock,
      title: 'Date Control',
      href: `${MDL_BASE}/settings/date-control`,
      description: 'How far back (and ahead) submission, comments and approve dates may be entered — for every list or per list.',
      state: `${settings.dateControl.enabled ? 'On' : 'Off'} · ${describeDateRule(settings.dateControl)}${ownRules ? ` · ${ownRules} list${ownRules === 1 ? '' : 's'} with their own rule` : ''}`,
      gradient: 'from-amber-500 to-orange-500',
      bg: 'bg-amber-50',
      iconColor: 'text-amber-600',
    },
    {
      icon: BookmarkCheck,
      title: 'Saved Column Mappings',
      href: `${MDL_BASE}/settings/import-mappings`,
      description: 'Column layouts the Excel Import remembered, per drawing list and heading row — see them, or remove one to detect afresh.',
      state: !canSeeMappings ? 'Needs Import › View' : saved === undefined ? 'Loading…' : saved ? `${saved} saved mapping${saved === 1 ? '' : 's'}` : 'None saved yet',
      gradient: 'from-rose-500 to-pink-600',
      bg: 'bg-rose-50',
      iconColor: 'text-rose-600',
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader icon={Settings2} title="Master Drawing List Settings" description="Drawing lists, the lists drawings are filed under, and how the forms and dates behave — each in its own place." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link key={card.title} href={card.href} className="no-underline">
            <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className={cn('h-1 w-full bg-gradient-to-r', card.gradient)} />
              <div className="flex flex-1 items-start gap-3 p-4">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', card.bg)}>
                  <card.icon className={cn('h-5 w-5', card.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">{card.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
                  <p className="mt-2 truncate text-xs font-medium text-slate-700" title={card.state}>
                    {card.state}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
