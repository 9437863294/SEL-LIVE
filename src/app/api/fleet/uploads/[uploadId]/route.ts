import { fleetRoute } from '@/lib/fleet/server/context';
import { readUpload } from '@/lib/fleet/server/uploads';

export const GET = fleetRoute<{ uploadId: string }>('uploads.read', async ({ context, params }) => readUpload(context, params.uploadId));
