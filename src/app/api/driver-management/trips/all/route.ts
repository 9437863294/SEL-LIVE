import { tripRoute } from '@/lib/employee-trips/server/context';
import { listAllTrips } from '@/lib/employee-trips/server/trips';

/**
 * Every employee's trips — the organisation-wide register.
 *
 * `GET /api/driver-management/trips/all`
 *
 * A route of its own rather than a query parameter on `trips`: that endpoint answers "my trips"
 * and is called by every employee, and widening it on a flag would put the permission check one
 * forgotten argument away from being skipped.
 */
export const GET = tripRoute('trips.listAll', async ({ context }) => ({
  trips: await listAllTrips(context),
}));
