/**
 * Turning whatever a person picks into a sensible profile photo, entirely in the browser.
 *
 * The old page uploaded the original file under its own name — a 12 MB phone photo, a PDF renamed
 * to .jpg, a file called `../x` — straight into storage. This checks the type and size, decodes the
 * image (so a non-image fails here, not later), crops it to a centred square and re-encodes it as a
 * 512px JPEG. Re-encoding also drops the camera's metadata, GPS position included.
 */

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MIN_SIDE = 96;
const OUTPUT_SIDE = 512;

export class PhotoError extends Error {}

export interface PreparedPhoto {
  blob: Blob;
  /** An object URL for previewing the result; revoke it when done. */
  previewUrl: string;
}

export async function prepareProfilePhoto(file: File): Promise<PreparedPhoto> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) throw new PhotoError('Choose a JPEG, PNG or WebP image.');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('Choose an image under 8 MB.');

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation, so portrait phone photos are not sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('That file could not be read as an image.');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side < MIN_SIDE) throw new PhotoError(`Choose an image at least ${MIN_SIDE}×${MIN_SIDE} pixels.`);
    const output = Math.min(OUTPUT_SIDE, side);
    const canvas = document.createElement('canvas');
    canvas.width = output;
    canvas.height = output;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoError('This browser cannot prepare images.');
    context.imageSmoothingQuality = 'high';
    // Transparent PNGs would turn black as JPEG; give them a white background instead.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output, output);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, output, output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new PhotoError('The image could not be prepared.');
    return { blob, previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

/** Initials for the avatar fallback: first letters of the first two words. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || 'U').toUpperCase();
}

/** A display name as stored: trimmed, single-spaced, 2–80 characters, no markup characters. */
export function cleanDisplayName(value: string): { name: string; error: string | null } {
  const name = value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { name, error: 'Enter at least 2 characters.' };
  if (name.length > 80) return { name, error: 'Keep it to 80 characters or fewer.' };
  return { name, error: null };
}
