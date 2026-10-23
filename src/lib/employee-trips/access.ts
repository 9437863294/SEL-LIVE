/**
 * What a person may do with trip claims beyond their own, from their resolved permissions.
 *
 * Recording trips and claiming them needs no permission at all — every signed-in user does it for
 * themselves. Approving and paying need none either: being named on a workflow stage is the
 * authority (`workflow.ts`). The permissions here are the wider grants:
 *
 * - `Driver Management · Trip Claims · View All` — every employee's claims and trips, and the
 *   organisation figures on the dashboard. The retired Employee Trip Log / Employee Trip
 *   Reimbursement grants (View or Approve) count as this, so roles set up for the old page keep
 *   their reach.
 * - `Trip Claims · Export` (with View All) — the CSV of the claims register.
 * - `Trip Claims · Override Workflow` — act at any stage for an absent assignee, logged as such.
 * - `Trip Settings · View / Edit` — the rate card, rules and workflow. Vehicle Management ·
 *   Settings · Edit also edits them, so whoever runs the fleet's settings can set the rates.
 */

import { hasPermission, type PermissionSubject } from '../access-control.ts';

export const TRIP_CLAIMS_RESOURCE = 'Driver Management.Trip Claims';
export const TRIP_SETTINGS_RESOURCE = 'Driver Management.Trip Settings';

const LEGACY_RESOURCES = ['Driver Management.Employee Trip Log', 'Vehicle Management.Employee Trip Reimbursement'];

export interface TripAccess {
  viewAll: boolean;
  exportAll: boolean;
  override: boolean;
  settingsView: boolean;
  settingsEdit: boolean;
}

export function resolveTripAccess(subject: PermissionSubject): TripAccess {
  const has = (resource: string, action: string) => hasPermission(subject, resource, action);
  const legacyView = LEGACY_RESOURCES.some((resource) => has(resource, 'View') || has(resource, 'Approve'));
  const viewAll = has(TRIP_CLAIMS_RESOURCE, 'View All') || legacyView;
  const settingsEdit = has(TRIP_SETTINGS_RESOURCE, 'Edit') || has('Vehicle Management.Settings', 'Edit');
  return {
    viewAll,
    exportAll: viewAll && (has(TRIP_CLAIMS_RESOURCE, 'Export') || LEGACY_RESOURCES.some((resource) => has(resource, 'Export'))),
    override: has(TRIP_CLAIMS_RESOURCE, 'Override Workflow'),
    settingsView: settingsEdit || has(TRIP_SETTINGS_RESOURCE, 'View'),
    settingsEdit,
  };
}
