import { mdlRoute, readJson } from '@/lib/master-drawing-list/server/context';
import { createProject } from '@/lib/master-drawing-list/server/items';
import { settingsProjects } from '@/lib/master-drawing-list/server/queries';
import { newProjectInputSchema } from '@/lib/master-drawing-list/schemas';

/** Settings › Projects: the drawing lists, their ERP links and the ERP projects to link to. */
export const GET = mdlRoute('projects.list', async ({ context }) => settingsProjects(context));

/** A new drawing list for an ERP project (Settings · Manage), so items can be added without an import. */
export const POST = mdlRoute('projects.create', async ({ request, context }) => createProject(context, newProjectInputSchema.parse(await readJson(request))));
