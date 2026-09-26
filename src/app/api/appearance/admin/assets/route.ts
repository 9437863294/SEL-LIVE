import { NextResponse } from 'next/server';
import { AccessDeniedError } from '@/lib/access-control-server';
import { adminCaller, auditAppearance, errorResponse, requireRight } from '@/lib/appearance/api';
import { ASSET_RULES, assetProblems, probeImage } from '@/lib/appearance/image-probe';
import { BRAND_ASSET_KINDS, type BrandAssetKind } from '@/lib/appearance/model';
import { uploadBrandAsset } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/**
 * Upload one brand image. The bytes are checked — real format, size, dimensions, shape — before
 * anything is stored; the file only takes effect once branding referencing it is saved.
 */
export async function POST(request: Request) {
  try {
    const caller = await adminCaller(request);
    requireRight(caller.rights, 'editBranding', 'upload branding images');
    const form = await request.formData().catch(() => {
      throw new AccessDeniedError('Send the image as multipart form data.', 400);
    });
    const kind = BRAND_ASSET_KINDS.find((k) => k === form.get('kind')) as BrandAssetKind | undefined;
    const file = form.get('file');
    if (!kind) throw new AccessDeniedError('Say which image this is.', 400);
    if (!(file instanceof Blob)) throw new AccessDeniedError('Choose an image to upload.', 400);
    // Refuse oversized bodies before reading them all into memory.
    if (file.size > ASSET_RULES[kind].maxBytes) {
      throw new AccessDeniedError(`${ASSET_RULES[kind].label} must be ${Math.round(ASSET_RULES[kind].maxBytes / 1024)} KB or smaller.`, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const probe = probeImage(bytes);
    const problems = assetProblems(kind, bytes, probe);
    if (problems.length || !probe) return NextResponse.json({ error: problems.join(' '), problems }, { status: 422 });
    const asset = await uploadBrandAsset(kind, bytes, probe);
    await auditAppearance(request, caller, 'Brand image uploaded', { kind, path: asset.path, width: asset.width, height: asset.height, size: asset.size });
    return NextResponse.json({ asset });
  } catch (error) {
    return errorResponse(error);
  }
}
