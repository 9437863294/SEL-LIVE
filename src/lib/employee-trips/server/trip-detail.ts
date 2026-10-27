import 'server-only';

/**
 * One trip, for its own page: the route on the map, what was measured and what was claimed, and
 * where its claim stands.
 *
 * Seen by exactly those who see the trip somewhere already — the employee (My Trips), the
 * organisation-wide register (Trip Claims · View All, as All Trips), and whoever may open the claim
 * it is on (its workflow, Override). Its own module because the claim check lives in claims.ts,
 * which imports trips.ts.
 */

import { ET_COLLECTIONS, type TripRecord } from '../types.ts';
import { canViewClaim, toClaim } from './claims';
import { TripError, db, type TripContext } from './context';
import { toTrip } from './trips';

export async function getTrip(context: TripContext, tripId: string): Promise<{ trip: TripRecord; mine: boolean }> {
  const snapshot = await db().collection(ET_COLLECTIONS.trips).doc(tripId).get();
  const trip = snapshot.exists ? toTrip(snapshot.id, snapshot.data()!) : null;
  if (!trip || trip.organizationId !== context.organizationId) throw new TripError('That trip was not found.', 404);
  const mine = trip.employeeId === context.userId;
  if (mine || context.trip.viewAll) return { trip, mine };
  if (trip.claimId) {
    const claim = await db().collection(ET_COLLECTIONS.claims).doc(trip.claimId).get();
    if (claim.exists && canViewClaim(context, toClaim(claim.id, claim.data()!))) return { trip, mine };
  }
  throw new TripError('You do not have access to this trip.', 403);
}
