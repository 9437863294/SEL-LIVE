import 'server-only';

import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminBucket, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import type { ImageProbe } from '@/lib/appearance/image-probe';
import { sanitizeProfileLetterhead } from '@/lib/letterhead-sanitize';
import { readPublished } from '@/lib/appearance/server';
import { DEFAULT_COMPANY_PROFILE, sanitizeCompanyProfile, type CompanyProfile } from '@/lib/company-profile';

/**
 * `settings/companyProfile`, read and written with the Admin SDK. The document is readable by any
 * signed-in client (the `settings` catch-all), but writes come only through `/api/company-profile`
 * after its permission check.
 */
const profileRef = () => getFirebaseAdminFirestore().collection('settings').doc('companyProfile');

/** Every email and print route asks for the profile; one read a minute per instance is plenty. */
const CACHE_MS = 60_000;
let cache: { at: number; value: Promise<CompanyProfile> } | null = null;

export interface CompanyProfileActor {
  userId: string;
  userName: string;
  userEmail: string | null;
}

async function loadProfile(): Promise<CompanyProfile> {
  const [snapshot, published] = await Promise.all([profileRef().get(), readPublished().catch(() => null)]);
  // The designed header/footer is re-cleaned on every read, so emails and prints never see markup
  // stored under an older allow-list.
  const profile = sanitizeProfileLetterhead(sanitizeCompanyProfile(snapshot.exists ? snapshot.data() : undefined));
  // No logo of its own: use the published light logo, so the letterhead matches the app header.
  if (!profile.logoUrl && published?.branding.logoLight?.url) return { ...profile, logoUrl: published.branding.logoLight.url };
  return profile;
}

/**
 * The document as stored, without the appearance-logo fallback and uncached — for the settings
 * screen, so saving does not copy the app logo's current URL into the profile.
 */
export async function readStoredCompanyProfile(): Promise<CompanyProfile> {
  const snapshot = await profileRef().get();
  return sanitizeProfileLetterhead(sanitizeCompanyProfile(snapshot.exists ? snapshot.data() : undefined));
}

/** The stored profile, else the defaults — never throws. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = loadProfile().catch((error) => {
    console.error('[company-profile] read failed; using defaults', error);
    // A failed read is not kept: the next request tries again.
    if (cache?.value === value) cache = null;
    return DEFAULT_COMPANY_PROFILE;
  });
  cache = { at: Date.now(), value };
  return value;
}

/** Validate and store the whole profile; returns what was stored (with the logo fallback applied). */
export async function saveCompanyProfile(input: unknown, actor: CompanyProfileActor): Promise<CompanyProfile> {
  const profile = sanitizeProfileLetterhead(sanitizeCompanyProfile(input));
  await profileRef().set({
    ...profile,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
    updatedBy: actor.userId,
    updatedByName: actor.userName,
  });
  cache = null;
  return getCompanyProfile();
}

const IMAGE_EXTENSIONS: Record<ImageProbe['type'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * An image for the designed letterhead, stored under `branding/letterhead/` with a download token —
 * the pattern of `uploadBrandAsset`. `branding/` is publicly readable and server-written only
 * (storage.rules), the same as the logo, so prints and emails can load it. Never overwritten.
 */
export async function uploadLetterheadImage(bytes: Uint8Array, probe: ImageProbe): Promise<{ path: string; url: string; width: number; height: number; size: number }> {
  const bucket = getFirebaseAdminBucket();
  const token = randomUUID();
  const path = `branding/letterhead/${Date.now()}-${randomUUID().slice(0, 8)}.${IMAGE_EXTENSIONS[probe.type]}`;
  await bucket.file(path).save(Buffer.from(bytes), {
    resumable: false,
    contentType: probe.type,
    metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { path, url, width: probe.width, height: probe.height, size: bytes.length };
}
