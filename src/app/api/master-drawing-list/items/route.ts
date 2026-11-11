import { MdlError, mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { createItem } from '@/lib/master-drawing-list/server/items';
import { register } from '@/lib/master-drawing-list/server/queries';
import { newItemInputSchema } from '@/lib/master-drawing-list/schemas';

/** A project's register: `?project=<code>`. */
export const GET = mdlRoute('items.list', async ({ context, url }) => {
  const project = url.searchParams.get('project');
  if (!project) throw new MdlError('Choose a project.');
  return register(context, project);
});

export const POST = mdlRoute('items.create', async ({ request, context }) => createItem(context, newItemInputSchema.parse(await readJson(request))));
