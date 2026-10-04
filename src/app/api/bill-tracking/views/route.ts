import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { z } from 'zod';

import { listSavedViews, saveView } from '@/lib/bill-tracking/server/settings';

export const GET = btRoute('views.list', async ({ context, url }) => ({ views: await listSavedViews(context, url.searchParams.get('page') ?? '') }));
export const POST = btRoute('views.save', async ({ request, context }) => {
  const body = z.object({ page: z.string().max(80), name: z.string().max(60), query: z.string().max(2000) }).parse(await readJson(request));
  return saveView(context, body.page, body.name, body.query);
});
