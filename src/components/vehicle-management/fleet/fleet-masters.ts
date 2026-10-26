'use client';

/**
 * The data every fleet settings screen edits — settings, vehicles, geofences, purposes, projects
 * and the people who can be named approvers — loaded once from `GET /api/fleet/masters`, and who
 * may change it.
 *
 * Editing needs Fleet Settings · Edit (or Vehicle Management · Settings · Edit, as for every other
 * VM setting). The flag here only decides whether a screen offers its controls; the API checks it
 * again on every write.
 */

import { useAuthorization } from '@/hooks/useAuthorization';
import { FleetApiError } from '@/components/fleet/fleet-api';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import type { FleetSettings, FleetVehicle, Geofence, ProjectOption, Purpose } from '@/lib/fleet/types';

export interface FleetDirectoryUser {
  id: string;
  name: string;
  email: string;
}

/** The figures a vehicle record has of its own; null means the category default applies. */
export interface OwnFleetFigures {
  dailyKmLimit: number | null;
  monthlyKmLimit: number | null;
  mileageTolerancePct: number | null;
  serviceIntervalKm: number | null;
}

export type MastersVehicle = FleetVehicle & { own?: OwnFleetFigures };

export interface FleetMasters {
  settings: FleetSettings;
  vehicles: MastersVehicle[];
  geofences: Geofence[];
  purposes: Purpose[];
  projects: ProjectOption[];
  users: FleetDirectoryUser[];
}

export function useFleetMasters() {
  return useFleetQuery<FleetMasters>('masters');
}

export function useFleetSettingsAccess() {
  const { can, isLoading } = useAuthorization();
  const canEdit = can('Edit', 'Vehicle Management.Fleet Settings') || can('Edit', 'Vehicle Management.Settings');
  const canView = canEdit || can('View', 'Vehicle Management.Fleet Settings') || can('View', 'Vehicle Management.Settings');
  return { canView, canEdit, isLoading };
}

/** The server's per-field messages (`details.fields`), keyed by field path. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  return error instanceof FleetApiError && error.fields ? (error.fields as Record<string, string>) : {};
}

/** A number typed into a field: blank is null. */
export const numberOrNull = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const numberText = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

/** Names for ids, for showing approvers and escalation people. */
export function nameOf(users: readonly FleetDirectoryUser[], id: string | null | undefined): string {
  if (!id) return '';
  return users.find((user) => user.id === id)?.name ?? 'Unknown user';
}
