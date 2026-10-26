import { projectLinkRoute } from '@/lib/employee-projects/route';
import { projectLinksOverview } from '@/lib/employee-projects/server';

/**
 * One greytHR category's values, their links to Settings › Projects, and who may change them.
 * `?category=` picks the category; without it, the source category employees' projects come from.
 */
export const GET = projectLinkRoute('list', async ({ request, context }) => projectLinksOverview(context, new URL(request.url).searchParams.get('category')));
