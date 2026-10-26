import { projectLinkRoute, readBody } from '@/lib/employee-projects/route';
import { projectSourceOverview, saveProjectSource } from '@/lib/employee-projects/server';

/** Which greytHR category employees' projects come from ("Project Name", "Project Division"…). */
export const GET = projectLinkRoute('source', async ({ context }) => projectSourceOverview(context));

/** Switch it: `{ sourceCategory }`. Links of every category are kept. */
export const PUT = projectLinkRoute('source.save', async ({ request, context }) => saveProjectSource(context, await readBody(request)));
