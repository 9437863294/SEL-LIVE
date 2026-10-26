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
 * Just the question and two big tiles, side by side even on a phone — a driver answers it standing
 * beside the vehicle, with one thumb. What each choice means is said on the screen it leads to. A
 * choice not open to the person (own vehicles switched off in Trip rules, company vehicles for
 * non-drivers) stays visible, greyed, with one line saying why, rather than disappearing.
 *
 * Rendered inside the GPS recorder's provider so "Own vehicle" can open its start directly.
 */

import { Building2, Car, type LucideIcon } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGpsTripControls } from '@/components/driver-management/trips/gps-trip-recorder';
import { cn } from '@/lib/utils';

interface Choice {
  key: 'own' | 'company';
  icon: LucideIcon;
  label: string;
  blocked: string | null;
  tone: string;
  choose: () => void;
}

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

  const choices: Choice[] = [
    {
      key: 'own',
      icon: Car,
      label: 'Own vehicle',
      blocked: ownBlocked ?? (gps.available ? null : 'Own vehicle: still loading — try again in a moment.'),
      tone: 'bg-teal-50 text-teal-700',
      choose: () => {
        onOpenChange(false);
        gps.start();
      },
    },
    {
      key: 'company',
      icon: Building2,
      label: 'Company vehicle',
      blocked: companyBlocked,
      tone: 'bg-sky-50 text-sky-700',
      choose: () => {
        onOpenChange(false);
        onCompany();
      },
    },
  ];
  const reasons = choices.filter((choice) => choice.blocked).map((choice) => choice.blocked as string);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" windowControls={false} aria-describedby={undefined} className="gap-0 rounded-2xl sm:rounded-2xl">
        {/* Even padding both sides, so the title sits in the middle despite the close button. */}
        <DialogHeader className="shrink-0 px-8 text-center sm:text-center">
          <DialogTitle className="text-lg">Which vehicle are you using?</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 pt-4">
          <div className="grid grid-cols-2 gap-3">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={choice.choose}
                disabled={Boolean(choice.blocked)}
                className={cn(
                  'flex min-h-[8.5rem] min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-white p-3 text-center transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  choice.blocked ? 'cursor-not-allowed border-slate-100 opacity-50' : 'border-slate-200 hover:border-primary hover:bg-primary/5 active:scale-[0.98]',
                )}
              >
                <span className={cn('flex h-14 w-14 items-center justify-center rounded-2xl', choice.tone)}>
                  <choice.icon className="h-7 w-7" aria-hidden />
                </span>
                <span className="text-sm font-semibold leading-tight text-slate-800">{choice.label}</span>
              </button>
            ))}
          </div>
          {reasons.map((reason) => (
            <p key={reason} className="text-center text-xs text-muted-foreground">
              {reason}
            </p>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
