import { NextResponse } from 'next/server';
import { checkerFor } from '@/lib/access-control';
import { AccessDeniedError, accessErrorResponse, authenticateAccess } from '@/lib/access-control-server';
import { logServerActivity, requestProvenance } from '@/lib/activity-logger-server';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { probeImage } from '@/lib/appearance/image-probe';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';
import { uploadLetterheadImage } from '@/lib/company-profile-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 4096;

/**
 * One image for the designed letterhead (a logo variant, a seal, a footer strip). The bytes are
 * probed — real PNG/JPEG/WebP, size, dimensions — before anything is stored under
 * `branding/letterhead/`. The image only shows once a header or footer that uses it is saved.
 */
export async function POST(request: Request) {
  try {
    const context = await authenticateAccess(request);
    if (!checkerFor(context.access)('Edit', COMPANY_PROFILE_RESOURCE)) {
      throw new AccessDeniedError('You do not have permission to edit the company profile.', 403);
    }
    const form = await request.formData().catch(() => {
      throw new AccessDeniedError('Send the image as multipart form data.', 400);
    });
    const file = form.get('file');
    if (!(file instanceof Blob)) throw new AccessDeniedError('Choose an image to upload.', 400);
    if (file.size > MAX_BYTES) throw new AccessDeniedError('Letterhead images must be 1 MB or smaller.', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const probe = probeImage(bytes);
    if (!probe) return NextResponse.json({ error: 'Only PNG, JPEG or WebP images are accepted.' }, { status: 422 });
    if (probe.width < 8 || probe.height < 8 || probe.width > MAX_SIDE || probe.height > MAX_SIDE) {
      return NextResponse.json({ error: `Letterhead images must be between 8 and ${MAX_SIDE} pixels on each side.` }, { status: 422 });
    }
    const asset = await uploadLetterheadImage(bytes, probe);
    await logServerActivity({
      userId: context.userId,
      userName: context.userName,
      userEmail: context.userEmail ?? undefined,
      module: ACTIVITY_MODULES.SETTINGS,
      action: 'Letterhead Image Uploaded',
      source: 'api',
      recordRef: asset.path,
      details: { width: asset.width, height: asset.height, size: asset.size },
      ...requestProvenance(request),
    });
    return NextResponse.json({ asset });
  } catch (error) {
    const { message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
