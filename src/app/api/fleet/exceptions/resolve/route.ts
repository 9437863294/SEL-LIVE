import { FleetError, readJson, fleetRoute } from '@/lib/fleet/server/context';
import { resolveFuelException } from '@/lib/fleet/server/fuel';
import { resolveTripException } from '@/lib/fleet/server/trips';

/** One route for both kinds; each resolver checks the kind and the caller again. */
export const POST = fleetRoute('exceptions.resolve', async ({ request, context }) => {
  const body = await readJson<{ kind?: unknown }>(request);
  if (body?.kind === 'trip') return resolveTripException(context, body);
  if (body?.kind === 'fuel') return resolveFuelException(context, body);
  throw new FleetError('Say whether this is a trip or a fuel entry.');
});
