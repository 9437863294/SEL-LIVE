import { fleetRoute } from '@/lib/fleet/server/context';
import { addDays } from '@/lib/fleet/dates';
import { listMyTrips, listTrips } from '@/lib/fleet/server/trips';

const dateParam = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/** The longest period one request lists: a year, inclusive. */
const MAX_RANGE_DAYS = 366;

/**
 * `scope=mine` (default): the caller's own trips. `all` / `managed`: across drivers, the last 31 IST
 * days unless from/to say otherwise (at most a year). `includeLegacy=1` adds the trips recorded
 * before SEL Fleet, for those who see every trip (the Fleet Trips register).
 */
export const GET = fleetRoute('trips.list', async ({ context, url }) => {
  const scope = url.searchParams.get('scope') ?? 'mine';
  if (scope === 'mine') return { trips: await listMyTrips(context) };
  const to = dateParam(url.searchParams.get('to')) ?? context.today;
  const earliest = addDays(to, -(MAX_RANGE_DAYS - 1));
  const asked = dateParam(url.searchParams.get('from')) ?? addDays(to, -30);
  const from = asked < earliest ? earliest : asked;
  const trips = await listTrips(context, {
    from,
    to,
    status: url.searchParams.get('status'),
    vehicleId: url.searchParams.get('vehicleId'),
    scope: scope === 'managed' ? 'managed' : 'all',
    includeLegacy: url.searchParams.get('includeLegacy') === '1',
  });
  return { trips, from, to };
});
