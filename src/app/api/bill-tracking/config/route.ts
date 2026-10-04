import { btRoute, readJson } from '@/lib/bill-tracking/server/context';
import { configInputSchema } from '@/lib/bill-tracking/schemas';
import { saveConfig } from '@/lib/bill-tracking/server/settings';

export const PUT = btRoute('config.save', async ({ request, context }) => ({ config: await saveConfig(context, configInputSchema.parse(await readJson(request))) }));
