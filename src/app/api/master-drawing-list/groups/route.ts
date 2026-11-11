import { MdlError, mdlRoute } from '@/lib/master-drawing-list/server/context';
import { groupsFor } from '@/lib/master-drawing-list/server/queries';

/** Add drawing item: a project's groups to suggest and its next Sl. No. per schedule and scope. */
export const GET = mdlRoute('groups', async ({ context, url }) => {
  const project = url.searchParams.get('project');
  if (!project) throw new MdlError('Choose a project.');
  return groupsFor(context, project);
});
