import { MdlError, mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { saveDateControl, saveFieldControl, saveMasterData } from '@/lib/master-drawing-list/server/settings';
import { dateControlInputSchema, fieldControlInputSchema, masterDataInputSchema } from '@/lib/master-drawing-list/schemas';

/** Save one settings section (Settings · Manage): master-data, field-control or date-control. */
export const PUT = mdlRoute<{ section: string }>('settings.save', async ({ request, context, params }) => {
  const body = await readJson(request);
  if (params.section === 'master-data') await saveMasterData(context, masterDataInputSchema.parse(body));
  else if (params.section === 'field-control') await saveFieldControl(context, fieldControlInputSchema.parse(body));
  else if (params.section === 'date-control') await saveDateControl(context, dateControlInputSchema.parse(body));
  else throw new MdlError('Unknown settings section.', 404);
  return { ok: true };
});
