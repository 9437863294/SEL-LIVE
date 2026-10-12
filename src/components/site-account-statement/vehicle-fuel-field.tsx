'use client';

import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { MANUAL_VEHICLE, vehicleLabel, type FuelVehicle } from '@/lib/site-account-statement-vehicle-fuel';
import type { VehicleFuelLink } from './use-vehicle-fuel';

/** A Select that only says why it cannot be used yet — the same look as the form's other disabled ones. */
function WaitingSelect({ text }: { text: string }) {
  return (
    <Select disabled>
      <SelectTrigger><SelectValue placeholder={text} /></SelectTrigger>
      <SelectContent />
    </Select>
  );
}

/**
 * The Vehicle field a vehicle-fuel expense shows, beside its sub-category.
 *
 * Renders nothing unless the category and sub-category stand for a vehicle type. The project's
 * vehicles of that type are offered first; "Not in the list" — or a project with none to offer —
 * takes a typed vehicle number instead, for a hired or borrowed vehicle.
 *
 * The label is plain text like its neighbours': an icon in a flex label sat it at a different
 * height from the labels beside it.
 */
export function VehicleFuelField({
  link,
  value,
  onChange,
  manualNumber,
  onManualNumberChange,
  kept,
  project,
  className,
}: {
  link: VehicleFuelLink;
  /** The chosen vehicle's id, `MANUAL_VEHICLE`, or '' for none yet. */
  value: string;
  onChange: (vehicleId: string) => void;
  manualNumber: string;
  onManualNumberChange: (number: string) => void;
  /** An edit's existing vehicle, offered even when it is no longer assigned to the project. */
  kept?: FuelVehicle | null;
  /** Whether a project is chosen, and whether it is linked to the master project list Vehicle Master uses. */
  project: { chosen: boolean; linked: boolean };
  className?: string;
}) {
  if (!link.vehicleType) return null;
  const type = link.vehicleType;

  const label = (
    <Label>Vehicle ({type}) <span className="text-destructive">*</span></Label>
  );
  const numberInput = (
    <Input
      value={manualNumber}
      onChange={e => onManualNumberChange(e.target.value)}
      placeholder="Vehicle number, e.g. OD02CN7704"
      autoComplete="off"
      className="uppercase placeholder:normal-case"
    />
  );
  const note = (text: string, warn = false) => (
    <p className={cn('flex items-start gap-1 text-[11px]', warn ? 'text-amber-700' : 'text-muted-foreground')}>
      {warn && <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
      {text}
    </p>
  );

  if (!project.chosen) {
    return <div className={cn('space-y-1.5', className)}>{label}<WaitingSelect text="Select a project first" /></div>;
  }
  if (link.loading) {
    return <div className={cn('space-y-1.5', className)}>{label}<WaitingSelect text="Loading vehicles…" /></div>;
  }

  // A kept vehicle that has left the project is still listed, so the edit can keep it.
  const keptMoved = kept && !link.options.some(v => v.id === kept.id) ? kept : null;
  const choices = keptMoved ? [...link.options, keptMoved] : link.options;

  // Nothing to pick from: the number is typed, and the note says why.
  if (!project.linked || choices.length === 0) {
    return (
      <div className={cn('space-y-1.5', className)}>
        {label}
        {numberInput}
        {!project.linked
          ? note('This project is not linked to Vehicle Master — type the vehicle number.')
          : link.error
            ? note('Vehicle Master could not be read — type the vehicle number.', true)
            : note(`No ${type} is assigned to this project — type the vehicle number.`)}
      </div>
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {label}
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={`Select ${type}`} /></SelectTrigger>
        <SelectContent>
          {choices.map(v => <SelectItem key={v.id} value={v.id}>{vehicleLabel(v)}</SelectItem>)}
          <SelectSeparator />
          <SelectItem value={MANUAL_VEHICLE}>Not in the list — type the number</SelectItem>
        </SelectContent>
      </Select>
      {value === MANUAL_VEHICLE && numberInput}
      {keptMoved && value === keptMoved.id
        && note(`${vehicleLabel(keptMoved)} is no longer assigned to this project — kept from the original entry.`)}
    </div>
  );
}
