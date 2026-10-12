'use client';

import { AlertTriangle, Fuel, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { vehicleLabel, type FuelVehicle } from '@/lib/site-account-statement-vehicle-fuel';
import type { VehicleFuelLink } from './use-vehicle-fuel';

/**
 * The Vehicle picker a vehicle-fuel expense shows, beneath its sub-category.
 *
 * Renders nothing unless the category and sub-category stand for a vehicle type. When the
 * project has none of that type in Vehicle Master, it says so instead of offering an empty list —
 * the expense still saves, it just cannot log the fuel against a vehicle.
 */
export function VehicleFuelField({
  link,
  value,
  onChange,
  kept,
  project,
  className,
}: {
  link: VehicleFuelLink;
  value: string;
  onChange: (vehicleId: string) => void;
  /** An edit's existing vehicle, offered even when it is no longer assigned to the project. */
  kept?: FuelVehicle | null;
  /** Whether a project is chosen, and whether it is linked to the master project list Vehicle Master uses. */
  project: { chosen: boolean; linked: boolean };
  className?: string;
}) {
  if (!link.vehicleType) return null;
  if (!project.chosen || !project.linked) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <Label className="flex items-center gap-1.5">
          <Fuel className="h-3.5 w-3.5 text-muted-foreground" />
          Vehicle ({link.vehicleType})
        </Label>
        <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
          {project.chosen ? 'Project not linked to Vehicle Master' : 'Select a project first'}
        </div>
        {project.chosen && (
          <p className="text-[11px] text-muted-foreground">
            This site project has no master project, so its vehicles cannot be found — the expense saves without a fuel log.
          </p>
        )}
      </div>
    );
  }
  const type = link.vehicleType;
  // A kept vehicle that has left the project is still listed, so the edit can keep it.
  const keptMoved = kept && !link.options.some(v => v.id === kept.id) ? kept : null;
  const choices = keptMoved ? [...link.options, keptMoved] : link.options;
  const required = link.options.length > 0;

  let note: React.ReactNode = null;
  if (link.loading) {
    note = null;
  } else if (link.error) {
    note = (
      <p className="flex items-start gap-1 text-[11px] text-amber-700">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        Vehicle Master could not be read — the expense still saves, but may log no fuel.
      </p>
    );
  } else if (keptMoved && value === keptMoved.id) {
    note = (
      <p className="text-[11px] text-muted-foreground">
        {vehicleLabel(keptMoved)} is no longer assigned to this project — kept from when this expense was recorded.
      </p>
    );
  } else if (link.options.length === 0) {
    note = (
      <p className="text-[11px] text-muted-foreground">
        Vehicle Master has no {type} assigned to this project — the expense saves without a fuel log.
      </p>
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="flex items-center gap-1.5">
        <Fuel className="h-3.5 w-3.5 text-muted-foreground" />
        Vehicle ({type}) {required && <span className="text-destructive">*</span>}
      </Label>
      {link.loading ? (
        <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading vehicles…
        </div>
      ) : choices.length > 0 ? (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder={`Select ${type}`} /></SelectTrigger>
          <SelectContent>
            {choices.map(v => <SelectItem key={v.id} value={v.id}>{vehicleLabel(v)}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
          {link.error ? 'Vehicles unavailable' : `No ${type} on this project`}
        </div>
      )}
      {note}
    </div>
  );
}
