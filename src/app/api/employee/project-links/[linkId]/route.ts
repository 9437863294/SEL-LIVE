import { projectLinkRoute, readBody } from '@/lib/employee-projects/route';
import { saveProjectLink } from '@/lib/employee-projects/server';

/** Set which app projects one greytHR project value means: `{ projectIds }` (empty clears it). */
export const PUT = projectLinkRoute<{ linkId: string }>('save', async ({ request, context, params }) => saveProjectLink(context, params.linkId, await readBody(request)));
