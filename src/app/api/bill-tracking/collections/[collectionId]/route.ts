import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { collectionActionSchema, collectionInputSchema } from '@/lib/bill-tracking/schemas';
import { changeCollectionStatus, updateCollectionDetails } from '@/lib/bill-tracking/server/collections';

type Params = { collectionId: string };

/** Verify or cancel. */
export const POST = btRoute<Params>('collections.action', async ({ request, context, params }) => {
  const body = collectionActionSchema.parse(await readJson(request));
  await changeCollectionStatus(context, params.collectionId, body.action, body.reason);
  return { ok: true };
});

/** Reference details only — amounts change by cancel and re-enter. */
export const PATCH = btRoute<Params>('collections.details', async ({ request, context, params }) => {
  const body = collectionInputSchema.pick({ paymentMode: true, bankReference: true, utrNumber: true, bankAccountName: true, remarks: true }).parse(await readJson(request));
  await updateCollectionDetails(context, params.collectionId, body);
  return { ok: true };
});
