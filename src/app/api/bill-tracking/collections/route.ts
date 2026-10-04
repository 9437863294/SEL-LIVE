import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { collectionInputSchema } from '@/lib/bill-tracking/schemas';
import { createCollection } from '@/lib/bill-tracking/server/collections';
import { listCollections } from '@/lib/bill-tracking/server/queries';

export const GET = btRoute('collections.list', async ({ context, url }) => listCollections(context, url.searchParams));
export const POST = btRoute('collections.create', async ({ request, context }) => createCollection(context, collectionInputSchema.parse(await readJson(request))));
