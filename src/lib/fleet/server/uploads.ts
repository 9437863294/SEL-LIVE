import 'server-only';

/**
 * Photos: odometer readings, fuel bills, odometer baselines.
 *
 * The phone compresses a photo (1600 px on the long edge, JPEG 0.8 — spec §6) and posts it here
 * before the trip or fuel entry that uses it; the record then names the upload by id. The file is
 * written by the Admin SDK under `fleet/…`, which storage.rules closes to browsers, and read back
 * through `GET /api/fleet/uploads/[id]`, which checks who is asking. An upload can be attached to
 * one record only, and only by the person who took it.
 *
 * OCR (decision D2) runs here when Settings › Fleet turns it on: Google Cloud Vision reads the
 * photo, `pickOdometer` picks the plausible number, and the phone shows it as a suggestion. With OCR
 * off, or when it fails, the typed reading and the photo stand on their own.
 */

import { pickOdometer } from '../ocr.ts';
import { FLEET_COLLECTIONS, FLEET_STORAGE_PREFIX, stripUndefined } from '../types.ts';
import { uploadKinds, type UploadKind } from '../schemas.ts';
import { getFirebaseAdminAuth, getFirebaseAdminBucket } from '@/lib/firebase-admin';
import { db, FleetError, type FleetContext } from './context';
import { fleetVehicles, loadFleetSettings } from './lookups';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PDF_TYPE = 'application/pdf';

export interface UploadRecord {
  id: string;
  organizationId: string;
  kind: UploadKind;
  storagePath: string;
  contentType: string;
  size: number;
  vehicleId: string | null;
  uploadedById: string;
  uploadedByName: string;
  ocrKm: number | null;
  ocrText: string;
  attachedTo: { kind: 'trip' | 'fuel' | 'vehicle'; id: string } | null;
  attachedId: string | null;
  /** Who else may view it once attached (the record's managers). */
  viewerIds: string[];
  createdAt: string;
}

const uploads = () => db().collection(FLEET_COLLECTIONS.uploads);

/** Vision's text detection; null on any failure (no key, quota, timeout). */
async function readText(bytes: Buffer): Promise<string | null> {
  try {
    const key = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    let headers: Record<string, string> = { 'content-type': 'application/json' };
    let url = 'https://vision.googleapis.com/v1/images:annotate';
    if (key) url += `?key=${encodeURIComponent(key)}`;
    else {
      const credential = getFirebaseAdminAuth().app.options.credential;
      const token = credential ? await credential.getAccessToken() : null;
      if (!token?.access_token) return null;
      headers = { ...headers, authorization: `Bearer ${token.access_token}` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ requests: [{ image: { content: bytes.toString('base64') }, features: [{ type: 'TEXT_DETECTION', maxResults: 1 }] }] }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { responses?: Array<{ fullTextAnnotation?: { text?: string }; textAnnotations?: Array<{ description?: string }> }> };
      const first = body.responses?.[0];
      return first?.fullTextAnnotation?.text ?? first?.textAnnotations?.[0]?.description ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function saveUpload(context: FleetContext, request: Request): Promise<{ uploadId: string; ocrKm: number | null; ocrRan: boolean }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new FleetError('Send the photo as a form upload.');
  }
  const file = form.get('file');
  const kind = String(form.get('kind') ?? '') as UploadKind;
  const vehicleId = String(form.get('vehicleId') ?? '').trim() || null;
  if (!uploadKinds.includes(kind)) throw new FleetError('Unknown kind of upload.');
  if (!file || typeof file === 'string') throw new FleetError('Attach the photo.');
  const contentType = file.type || 'application/octet-stream';
  // A fuel bill may be a PDF from the pump's app; readings are photos.
  if (!IMAGE_TYPES.includes(contentType) && !(kind === 'fuel_bill' && contentType === PDF_TYPE)) throw new FleetError('Upload a JPEG, PNG or WebP photo.');
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new FleetError('The photo is too large — it should be under 6 MB.');

  const bytes = Buffer.from(await file.arrayBuffer());
  const ref = uploads().doc();
  const extension = contentType === PDF_TYPE ? 'pdf' : contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${FLEET_STORAGE_PREFIX}/${kind}/${context.today.slice(0, 7)}/${ref.id}.${extension}`;
  await getFirebaseAdminBucket().file(storagePath).save(bytes, { contentType, resumable: false });

  let ocrKm: number | null = null;
  let ocrText = '';
  let ocrRan = false;
  if (kind === 'odometer' && contentType !== PDF_TYPE) {
    const settings = await loadFleetSettings(context.organizationId);
    if (settings.ocrEnabled) {
      const text = await readText(bytes);
      ocrRan = text !== null;
      if (text) {
        ocrText = text.slice(0, 2000);
        const vehicle = vehicleId ? (await fleetVehicles(settings)).find((entry) => entry.id === vehicleId) : null;
        ocrKm = pickOdometer(text, { lastKm: vehicle?.currentOdometerKm ?? null }).km;
      }
    }
  }

  const record: UploadRecord = {
    id: ref.id,
    organizationId: context.organizationId,
    kind,
    storagePath,
    contentType,
    size: file.size,
    vehicleId,
    uploadedById: context.userId,
    uploadedByName: context.userName,
    ocrKm,
    ocrText,
    attachedTo: null,
    attachedId: null,
    viewerIds: [],
    createdAt: context.now,
  };
  await ref.set(stripUndefined(record));
  return { uploadId: ref.id, ocrKm, ocrRan };
}

/** An upload the caller took, of the right kind, not yet on any record. */
export async function claimableUpload(uploadId: string, userId: string, kind: UploadKind): Promise<UploadRecord> {
  const snapshot = await uploads().doc(uploadId).get();
  if (!snapshot.exists) throw new FleetError('That photo was not found — take it again.', 400);
  const upload = { ...(snapshot.data() as UploadRecord), id: snapshot.id };
  if (upload.uploadedById !== userId) throw new FleetError('That photo was taken by someone else.', 403);
  if (upload.kind !== kind) throw new FleetError('That photo is of the wrong kind.', 400);
  if (upload.attachedTo) throw new FleetError('That photo is already on another record — take a new one.', 409);
  return upload;
}

/** The write that attaches an upload (inside the caller's transaction or batch). */
export function attachment(attachedTo: UploadRecord['attachedTo'], viewerIds: string[]) {
  // `attachedId` top-level so a record's photos are one equality query away.
  return { attachedTo, attachedId: attachedTo?.id ?? null, viewerIds: [...new Set(viewerIds.filter(Boolean))] };
}

export const uploadRef = (uploadId: string) => uploads().doc(uploadId);

/** Stream a photo to someone allowed to see it. */
export async function readUpload(context: FleetContext, uploadId: string): Promise<Response> {
  const snapshot = await uploads().doc(uploadId).get();
  if (!snapshot.exists) throw new FleetError('Not found.', 404);
  const upload = snapshot.data() as UploadRecord;
  const settings = await loadFleetSettings(context.organizationId);
  const allowed =
    upload.uploadedById === context.userId ||
    upload.viewerIds?.includes(context.userId) ||
    settings.escalationUserIds.includes(context.userId) ||
    context.fleet.viewAll ||
    context.fleet.reportsView ||
    context.fleet.settingsView;
  if (!allowed) throw new FleetError('You cannot view this photo.', 403);
  const [bytes] = await getFirebaseAdminBucket().file(upload.storagePath).download();
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': upload.contentType, 'cache-control': 'private, max-age=3600', 'content-disposition': 'inline' },
  });
}
