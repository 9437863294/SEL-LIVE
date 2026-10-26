/**
 * Who may do what with the fleet, beyond driving and approving.
 *
 * Driving a fleet trip needs no permission: a Driver Master driver, or (Settings › Fleet, on by
 * default) any active employee, drives company vehicles. Approving over-limit running needs none
 * either — being the vehicle's approver, backup approver, the driver's reporting authority or on
 * the escalation list is the authority (workflow-assignment memory). The grants here are the wider
 * reach (Vehicle Management · …):
 *
 * - `Fleet Trips · View` — every fleet trip, the live map and the Exceptions list; `Review` settles
 *   trips and exceptions for any vehicle; `Force Close` ends someone else's running trip; `Export`.
 * - `Fleet Reports · View / Generate / Approve for Payment` — the monthly payment report.
 * - `Fleet Settings · View / Edit` — limits, thresholds, geofences, purposes, vehicle fleet fields,
 *   odometer baselines. Vehicle Management · Settings · Edit also edits them.
 */

import { hasPermission, type PermissionSubject } from '../access-control.ts';

export const FLEET_TRIPS_RESOURCE = 'Vehicle Management.Fleet Trips';
export const FLEET_REPORTS_RESOURCE = 'Vehicle Management.Fleet Reports';
export const FLEET_SETTINGS_RESOURCE = 'Vehicle Management.Fleet Settings';

export interface FleetAccess {
  viewAll: boolean;
  review: boolean;
  forceClose: boolean;
  exportTrips: boolean;
  reportsView: boolean;
  reportsGenerate: boolean;
  reportsApprove: boolean;
  settingsView: boolean;
  settingsEdit: boolean;
}

export function resolveFleetAccess(subject: PermissionSubject): FleetAccess {
  const has = (resource: string, action: string) => hasPermission(subject, resource, action);
  const settingsEdit = has(FLEET_SETTINGS_RESOURCE, 'Edit') || has('Vehicle Management.Settings', 'Edit');
  const review = has(FLEET_TRIPS_RESOURCE, 'Review');
  const viewAll = review || has(FLEET_TRIPS_RESOURCE, 'View') || has('Vehicle Management.Trip Management', 'View');
  const reportsApprove = has(FLEET_REPORTS_RESOURCE, 'Approve for Payment');
  const reportsGenerate = reportsApprove || has(FLEET_REPORTS_RESOURCE, 'Generate');
  return {
    viewAll,
    review,
    forceClose: has(FLEET_TRIPS_RESOURCE, 'Force Close'),
    exportTrips: viewAll && (has(FLEET_TRIPS_RESOURCE, 'Export') || has('Vehicle Management.Trip Management', 'Export')),
    reportsView: reportsGenerate || has(FLEET_REPORTS_RESOURCE, 'View'),
    reportsGenerate,
    reportsApprove,
    settingsView: settingsEdit || has(FLEET_SETTINGS_RESOURCE, 'View') || has('Vehicle Management.Settings', 'View'),
    settingsEdit,
  };
}
