'use client';

/**
 * "Which vehicle are you using?" — asked when a trip is started, because the answer decides what the
 * trip is: two separate calculations behind one Start button.
 *
 * - Own vehicle: the GPS trip recorder (gps-trip-recorder.tsx, own vehicles only). The trip goes to
 *   My Trips, priced per km from the trip-claims rate card, and is claimed from there.
 * - Company vehicle: the fleet trip — the vehicle's daily km limit, odometer photos, billed to the
 *   project, never claimable.
 *
 * A prompt rather than tabs on the page: nobody should have to notice which tab was left selected
 * before setting off, and a choice that is not open to the person (own vehicles switched off in Trip
 * rules, or company vehicles for non-drivers) says why instead of disappearing.
 *
 * Rendered inside the GPS recorder's provider so "Own vehicle" can open its start directly.
 */

import { Building2, Car, ChevronRight } from 'lucide-react';
import { FormDialog } from '@/components/shared/form-dialog';
import { useGpsTripControls } from '@/components/driver-management/trips/gps-trip-recorder';
import { cn } from '@/lib/utils';

export function VehicleChoiceDialog({
  open,
  onOpenChange,
  ownBlocked,
  companyBlocked,
  onCompany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why an own-vehicle trip cannot be recorded now, or null. */
  ownBlocked: string | null;
  /** Why a company-vehicle trip cannot be started now, or null. */
  companyBlocked: string | null;
  onCompany: () => void;
}) {
  const gps = useGpsTripControls();
  const ownReason = ownBlocked ?? (gps.available ? null : 'Trip claims are still loading — try again in a moment.');

  const options = [
    {
      key: 'own',
      icon: Car,
      title: 'Own vehicle',
      tag: 'Claimable',
      text: "Your own car or bike. The trip goes to My Trips at the company's per-km rate for your vehicle, and you claim it from there.",
      blocked: ownReason,
      choose: () => {
        onOpenChange(false);
        gps.start();
      },
    },
    {
      key: 'company',
      icon: Building2,
      title: 'Company vehicle',
      tag: 'Fleet · not claimable',
      text: "A vehicle from Vehicle Master. Billed to the project, held to the vehicle's daily km limit, with an odometer photo at the start and the end.",
      blocked: companyBlocked,
      choose: () => {
        onOpenChange(false);
        onCompany();
      },
    },
  ];

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} size="md" title="Which vehicle are you using?" description="The trip is recorded by GPS either way; the vehicle decides how it is paid.">
      <div className="grid grid-cols-1 gap-3" role="list">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="listitem"
            onClick={option.choose}
            disabled={Boolean(option.blocked)}
            className={cn(
              'group flex w-full min-w-0 items-start gap-3 rounded-xl border bg-white p-4 text-left transition-colors',
              option.blocked ? 'cursor-not-allowed border-slate-200 opacity-60' : 'border-slate-200 hover:border-primary/50 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            )}
          >
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', option.key === 'own' ? 'bg-teal-50 text-teal-700' : 'bg-sky-50 text-sky-700')}>
              <option.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-slate-800">{option.title}</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', option.key === 'own' ? 'bg-teal-50 text-teal-700' : 'bg-sky-50 text-sky-700')}>{option.tag}</span>
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.blocked ?? option.text}</span>
            </span>
            {!option.blocked && <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-primary" aria-hidden />}
          </button>
        ))}
      </div>
    </FormDialog>
  );
}
