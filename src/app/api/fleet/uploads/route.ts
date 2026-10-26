import { fleetRoute } from '@/lib/fleet/server/context';
import { saveUpload } from '@/lib/fleet/server/uploads';

export const POST = fleetRoute('uploads.create', async ({ request, context }) => saveUpload(context, request));
