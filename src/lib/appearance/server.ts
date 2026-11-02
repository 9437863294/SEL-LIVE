import 'server-only';

import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminBucket, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { permissionModules } from '@/lib/permissions';
import {
  DEFAULT_PUBLISHED,
  NAV_STYLES,
  THEME_MODES,
  isOneOf,
  sanitizeBranding,
  sanitizeConfig,
  sanitizeDefaults,
  sanitizePreferences,
  sanitizePublished,
  sanitizeTheme,
  withCompanyDefault,
  type BrandAsset,
  type BrandAssetKind,
  type CompanyAppearanceConfig,
  type DirectDefaultField,
  type PublishedAppearance,
  type UserAppearancePreferences,
} from './model';
import { AccessDeniedError } from '@/lib/access-control-server';
import type { ImageProbe } from './image-probe';
import { changedPaths } from './diff';

/**
 * Where the appearance system keeps its data, following the `settings/{name}` convention the
 * organisation-wide settings already use (`settings/workingHours`, `settings/printing`, …):
 *
 *   settings/appearance                  the published configuration every client applies
 *   settings/appearance/versions/{n}     an immutable snapshot of every version ever published
 *   settings/appearanceDraft             the theme administrators are working on, not yet live
 *   userAppearance/{uid}                 one user's preferences, keyed by their auth uid
 *
 * All company writes go through here, with the Admin SDK, after the API route has checked the
 * caller's permissions — the client SDK is never trusted with them.
 */
const SETTINGS = 'settings';
const PUBLISHED_ID = 'appearance';
const DRAFT_ID = 'appearanceDraft';
const PREFERENCES = 'userAppearance';

const db = () => getFirebaseAdminFirestore();
const publishedRef = () => db().collection(SETTINGS).doc(PUBLISHED_ID);
const draftRef = () => db().collection(SETTINGS).doc(DRAFT_ID);
const versionsRef = () => publishedRef().collection('versions');

export const KNOWN_MODULES = Object.keys(permissionModules);

export interface AppearanceActor {
  userId: string;
  userName: string;
  userEmail: string | null;
}

export type VersionKind = 'publish' | 'branding' | 'restore';

export interface VersionSummary {
  version: number;
  kind: VersionKind;
  publishedAt: string | null;
  publishedBy: string | null;
  note: string;
  changes: string[];
  restoredFrom: number | null;
}

export interface DraftState {
  config: CompanyAppearanceConfig;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The published version the draft started from — shown so a stale draft is obvious. */
  basedOnVersion: number;
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

export async function readPublished(): Promise<PublishedAppearance> {
  const snapshot = await publishedRef().get();
  return snapshot.exists ? sanitizePublished(snapshot.data()) : DEFAULT_PUBLISHED;
}

export async function readDraft(published?: PublishedAppearance): Promise<DraftState> {
  const base = published ?? (await readPublished());
  const snapshot = await draftRef().get();
  if (!snapshot.exists) {
    return { config: stripMeta(base), updatedAt: null, updatedBy: null, basedOnVersion: base.version };
  }
  const data = snapshot.data() ?? {};
  // The draft only ever holds a theme and defaults; branding is always the published one.
  const config = sanitizeConfig({ ...data, branding: base.branding }, stripMeta(base));
  return {
    config,
    updatedAt: typeof data.updatedAtIso === 'string' ? data.updatedAtIso : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    basedOnVersion: Number.isInteger(data.basedOnVersion) ? data.basedOnVersion : base.version,
  };
}

export async function listVersions(limit = 25): Promise<VersionSummary[]> {
  const snapshot = await versionsRef().orderBy('version', 'desc').limit(limit).get();
  return snapshot.docs.map((entry) => {
    const data = entry.data();
    return {
      version: Number(data.version) || 0,
      kind: (['publish', 'branding', 'restore'] as const).includes(data.kind) ? data.kind : 'publish',
      publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
      publishedBy: typeof data.publishedBy === 'string' ? data.publishedBy : null,
      note: typeof data.note === 'string' ? data.note : '',
      changes: Array.isArray(data.changes) ? data.changes.filter((c: unknown) => typeof c === 'string').slice(0, 40) : [],
      restoredFrom: Number.isInteger(data.restoredFrom) ? data.restoredFrom : null,
    };
  });
}

function stripMeta(published: PublishedAppearance): CompanyAppearanceConfig {
  return { branding: published.branding, theme: published.theme, defaults: published.defaults };
}

// ── Writing company appearance ─────────────────────────────────────────────────────────────────

function versionDoc(
  config: CompanyAppearanceConfig,
  version: number,
  actor: AppearanceActor,
  kind: VersionKind,
  note: string,
  changes: string[],
  restoredFrom: number | null = null,
) {
  const publishedAt = new Date().toISOString();
  return {
    ...config,
    version,
    publishedAt,
    publishedBy: actor.userName,
    publishedById: actor.userId,
    note,
    kind,
    changes,
    restoredFrom,
    publishedAtTs: FieldValue.serverTimestamp(),
  };
}

export async function saveDraft(actor: AppearanceActor, input: unknown): Promise<DraftState> {
  const published = await readPublished();
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const theme = sanitizeTheme(raw.theme, published.theme);
  const defaults = sanitizeDefaults(raw.defaults, theme, published.defaults);
  const updatedAtIso = new Date().toISOString();
  await draftRef().set({
    theme,
    defaults,
    basedOnVersion: published.version,
    updatedBy: actor.userName,
    updatedById: actor.userId,
    updatedAtIso,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { config: { branding: published.branding, theme, defaults }, updatedAt: updatedAtIso, updatedBy: actor.userName, basedOnVersion: published.version };
}

export interface PublishResult {
  published: PublishedAppearance;
  changes: string[];
}

/** Make the draft live as a new version. The version number is allocated inside a transaction. */
export async function publishDraft(actor: AppearanceActor, note: string): Promise<PublishResult> {
  const draft = await readDraft();
  return db().runTransaction(async (tx) => {
    const current = await tx.get(publishedRef());
    const before = current.exists ? sanitizePublished(current.data()) : DEFAULT_PUBLISHED;
    const config: CompanyAppearanceConfig = { branding: before.branding, theme: draft.config.theme, defaults: draft.config.defaults };
    const changes = changedPaths(stripMeta(before), config);
    const version = before.version + 1;
    const doc = versionDoc(config, version, actor, 'publish', note, changes);
    tx.set(publishedRef(), doc);
    tx.set(versionsRef().doc(String(version)), doc);
    return { published: sanitizePublished(doc), changes };
  });
}

export interface DefaultChangeResult extends PublishResult {
  /** How many people's own choice of that setting was removed, so the new default reaches them. */
  cleared: number;
}

/**
 * Make one company default live at once, from an administrator's own choice on My Appearance: a
 * new version like a draft publish, holding only this change. The draft gets the change too, so
 * publishing it later does not quietly undo this one. With `clearChoices`, that setting is also
 * removed from everyone's own preferences, so people who had chosen for themselves follow it.
 */
export async function publishDefault(
  actor: AppearanceActor,
  field: unknown,
  value: unknown,
  options: { clearChoices: boolean; note: string | null },
): Promise<DefaultChangeResult> {
  const result = await db().runTransaction(async (tx) => {
    const [current, draftSnap] = await Promise.all([tx.get(publishedRef()), tx.get(draftRef())]);
    const before = current.exists ? sanitizePublished(current.data()) : DEFAULT_PUBLISHED;
    const defaults = withCompanyDefault(before.defaults, before.theme, field, value);
    if (!defaults) throw new AccessDeniedError('That is not a choice the company default can be set to.', 400);
    const config: CompanyAppearanceConfig = { ...stripMeta(before), defaults };
    const changes = changedPaths(stripMeta(before), config);
    if (!changes.length) return { published: before, changes };
    const version = before.version + 1;
    const note = options.note ?? `Company default ${String(field)} set to ${String(value)}`;
    const doc = versionDoc(config, version, actor, 'publish', note, changes);
    tx.set(publishedRef(), doc);
    tx.set(versionsRef().doc(String(version)), doc);
    if (draftSnap.exists) {
      const draft = draftSnap.data() ?? {};
      // A draft that was up to date still is: it now holds the same change as the new version.
      tx.update(draftRef(), {
        [`defaults.${String(field)}`]: value,
        ...(draft.basedOnVersion === before.version ? { basedOnVersion: version } : {}),
      });
    }
    return { published: sanitizePublished(doc), changes };
  });
  return { ...result, cleared: options.clearChoices ? await clearPreference(String(field)) : 0 };
}

/** People who have chosen this setting for themselves, rather than following the company. */
export async function countPreference(field: DirectDefaultField): Promise<number> {
  const snapshot = await db().collection(PREFERENCES).where(field, '!=', null).count().get();
  return snapshot.data().count;
}

async function clearPreference(field: string): Promise<number> {
  const snapshot = await db().collection(PREFERENCES).where(field, '!=', null).get();
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = db().batch();
    for (const entry of snapshot.docs.slice(i, i + 400)) batch.update(entry.ref, { [field]: FieldValue.delete() });
    await batch.commit();
  }
  return snapshot.size;
}

/** Branding changes go live on save — as a version of their own, so they can be restored. */
export async function saveBranding(actor: AppearanceActor, input: unknown, note: string): Promise<PublishResult> {
  return db().runTransaction(async (tx) => {
    const current = await tx.get(publishedRef());
    const before = current.exists ? sanitizePublished(current.data()) : DEFAULT_PUBLISHED;
    const branding = sanitizeBranding(input, before.branding);
    const config: CompanyAppearanceConfig = { ...stripMeta(before), branding };
    const changes = changedPaths(before.branding, branding, 'branding');
    const version = before.version + 1;
    const doc = versionDoc(config, version, actor, 'branding', note, changes);
    tx.set(publishedRef(), doc);
    tx.set(versionsRef().doc(String(version)), doc);
    return { published: sanitizePublished(doc), changes };
  });
}

export type RestoreScope = 'all' | 'theme' | 'branding';

/**
 * Put an earlier version back, as a new version: history only ever grows, so restoring is itself
 * something that can be undone. `theme` restores the theme and defaults and keeps today's
 * branding; `branding` does the opposite.
 */
export async function restoreVersion(actor: AppearanceActor, version: number, scope: RestoreScope): Promise<PublishResult> {
  const source = await versionsRef().doc(String(version)).get();
  if (!source.exists) throw new Error(`Version ${version} does not exist.`);
  const restored = sanitizeConfig(source.data());
  return db().runTransaction(async (tx) => {
    const current = await tx.get(publishedRef());
    const before = current.exists ? sanitizePublished(current.data()) : DEFAULT_PUBLISHED;
    const config: CompanyAppearanceConfig =
      scope === 'branding'
        ? { ...stripMeta(before), branding: restored.branding }
        : scope === 'theme'
          ? { branding: before.branding, theme: restored.theme, defaults: restored.defaults }
          : restored;
    const changes = changedPaths(stripMeta(before), config);
    const next = before.version + 1;
    const note = `Restored ${scope === 'all' ? 'everything' : scope} from version ${version}`;
    const doc = versionDoc(config, next, actor, 'restore', note, changes, version);
    tx.set(publishedRef(), doc);
    tx.set(versionsRef().doc(String(next)), doc);
    return { published: sanitizePublished(doc), changes };
  });
}

// ── Brand assets ───────────────────────────────────────────────────────────────────────────────

const EXTENSIONS: Record<ImageProbe['type'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Store a validated image under `branding/{kind}/` with a download token, the way Firebase's own
 * upload flow does, so the sign-in page can show it without a signed-in user. Files are never
 * overwritten or deleted here: an older version that points at one must still restore intact.
 */
export async function uploadBrandAsset(kind: BrandAssetKind, bytes: Uint8Array, probe: ImageProbe): Promise<BrandAsset> {
  const bucket = getFirebaseAdminBucket();
  const token = randomUUID();
  const path = `branding/${kind}/${Date.now()}-${randomUUID().slice(0, 8)}.${EXTENSIONS[probe.type]}`;
  await bucket.file(path).save(Buffer.from(bytes), {
    resumable: false,
    contentType: probe.type,
    metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { path, url, contentType: probe.type, width: probe.width, height: probe.height, size: bytes.length };
}

// ── Personal preferences ───────────────────────────────────────────────────────────────────────

export interface StoredPreferences {
  preferences: UserAppearancePreferences;
  updatedAt: string | null;
}

/**
 * A user's preferences. Before this collection existed the theme mode and bottom-bar style lived
 * on `users/{id}.theme`; until the user first saves here, those are carried over so nobody loses
 * a choice they had already made. (The old colour and font fields are not: they were saved but
 * never applied, so honouring them now would change people's screens to something they never saw.)
 */
export async function readPreferences(uid: string, legacyUserId: string): Promise<StoredPreferences> {
  const snapshot = await db().collection(PREFERENCES).doc(uid).get();
  if (snapshot.exists) {
    const data = snapshot.data() ?? {};
    return { preferences: sanitizePreferences(data, KNOWN_MODULES), updatedAt: typeof data.updatedAtIso === 'string' ? data.updatedAtIso : null };
  }
  const legacy = await db().collection('users').doc(legacyUserId).get();
  const theme = (legacy.data()?.theme ?? {}) as Record<string, unknown>;
  const preferences: UserAppearancePreferences = {};
  if (isOneOf(THEME_MODES, theme.mode)) preferences.mode = theme.mode;
  if (isOneOf(NAV_STYLES, theme.navStyle)) preferences.navStyle = theme.navStyle;
  return { preferences, updatedAt: null };
}

/** Replace a user's preferences wholesale — an empty object is "Reset to company defaults". */
export async function writePreferences(uid: string, input: unknown): Promise<StoredPreferences> {
  const preferences = sanitizePreferences(input, KNOWN_MODULES);
  const updatedAtIso = new Date().toISOString();
  await db().collection(PREFERENCES).doc(uid).set({ ...preferences, updatedAtIso, updatedAt: FieldValue.serverTimestamp() });
  return { preferences, updatedAt: updatedAtIso };
}
