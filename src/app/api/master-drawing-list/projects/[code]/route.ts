import { decodeParam, mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { linkProject } from '@/lib/master-drawing-list/server/items';
import { projectLinkInputSchema } from '@/lib/master-drawing-list/schemas';

/** Link a drawing list to an ERP project: `{ projectId }`, or `{ projectId: null }` to unlink. */
export const PATCH = mdlRoute<{ code: string }>('projects.link', async ({ request, context, params }) => {
  await linkProject(context, decodeParam(params.code), projectLinkInputSchema.parse(await readJson(request)));
  return { ok: true };
});
