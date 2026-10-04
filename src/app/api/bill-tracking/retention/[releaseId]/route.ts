import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { deleteSchema } from '@/lib/bill-tracking/schemas';
import { cancelRetentionRelease } from '@/lib/bill-tracking/server/records';

/** Cancels (never deletes) a manual release. */
export const DELETE = btRoute<{ releaseId: string }>('retention.cancel', async ({ request, context, params }) => {
  await cancelRetentionRelease(context, params.releaseId, deleteSchema.parse(await readJson(request)).reason);
  return { ok: true };
});
