import { fleetRoute } from '@/lib/fleet/server/context';
import { loadFleetSettings } from '@/lib/fleet/server/lookups';
import { runningTrips } from '@/lib/fleet/server/trips';

/** The live map: every open trip for Fleet Trips · View and the escalation list; otherwise those the caller manages. */
export const GET = fleetRoute('trips.running', async ({ context }) => {
  const [settings, trips] = await Promise.all([loadFleetSettings(context.organizationId), runningTrips()]);
  const all = context.fleet.viewAll || settings.escalationUserIds.includes(context.userId);
  return { trips: all ? trips : trips.filter((trip) => trip.managerIds.includes(context.userId)) };
});
