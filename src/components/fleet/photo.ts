'use client';

/**
 * Photos for the fleet: odometer readings, fuel bills, baselines.
 *
 * A phone camera's JPEG is 3–8 MB; over a site's mobile data that is the difference between a trip
 * that starts and one that times out. So every photo is shrunk here first — 1600 px on the long
 * edge, JPEG at 0.8 (spec §6) — which keeps a dashboard's digits readable at a few hundred KB. The
 * camera's EXIF orientation is applied while decoding, or a portrait shot of a meter arrives on its
 * side. PDFs (a pump's e-bill) and anything that will not decode are sent as they are; the server
 * enforces the type and size.
 */

import { fleetFetch } from './fleet-api';

const IMAGE = /^image\/(jpeg|png|webp|heic|heif)$/i;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older WebViews reject the options bag; fall through to an <img>, which applies EXIF itself.
    }
  }
  const href = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = href;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(href) };
  } catch (error) {
    URL.revokeObjectURL(href);
    throw error;
  }
}

export async function compressPhoto(file: Blob, options: { maxEdge?: number; quality?: number } = {}): Promise<Blob> {
  const maxEdge = options.maxEdge ?? 1600;
  const quality = options.quality ?? 0.8;
  if (typeof document === 'undefined' || !IMAGE.test(file.type || '')) return file;
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    // Keep the original when re-encoding would make it bigger (an already small PNG of a meter).
    return blob && (blob.size < file.size || !/^image\/(jpeg|png|webp)$/i.test(file.type)) ? blob : file;
  } finally {
    decoded.close();
  }
}

export interface UploadedPhoto {
  uploadId: string;
  /** What OCR read off an odometer photo, when Settings › Fleet has it on. A suggestion only. */
  ocrKm: number | null;
  ocrRan: boolean;
}

/** Compress (when not already done) and upload; the record that uses it names it by `uploadId`. */
export async function uploadFleetPhoto(file: Blob, kind: 'odometer' | 'fuel_bill' | 'baseline', vehicleId?: string | null): Promise<UploadedPhoto> {
  const ready = file.size > 1_000_000 ? await compressPhoto(file) : file;
  const form = new FormData();
  const extension = ready.type === 'application/pdf' ? 'pdf' : ready.type === 'image/png' ? 'png' : ready.type === 'image/webp' ? 'webp' : 'jpg';
  form.append('file', ready, `${kind}.${extension}`);
  form.append('kind', kind);
  if (vehicleId) form.append('vehicleId', vehicleId);
  return fleetFetch<UploadedPhoto>('uploads', { form });
}
